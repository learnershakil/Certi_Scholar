import type { Types } from 'mongoose';
import { ConsistencyCheckModel, DocumentModel, ExtractedFieldModel, type VerificationStatus } from '../models/document.js';
import { ApplicationModel, RecommendationModel, ScholarshipModel, ScholarshipRuleModel } from '../models/scholarship.js';
import { UserModel } from '../models/user.js';
import { deriveFacts, type DocumentFacts, type FactText } from '../domain/facts.js';
import { getSettings } from '../models/system.js';
import { evaluate, type RuleNode } from '../domain/rules.js';
import { authenticityStatement } from '../verification/providers.js';
import { notify, timeline } from '../lib/events.js';

const OUTCOME = { pass: 'recommended', fail: 'not_recommended', unknown: 'needs_review' } as const;

type DocumentRecord = { _id: Types.ObjectId; documentType?: string | null; verification?: { status?: string | null } | null };

/** Extracted fields, consistency results and verification status of each document, as the rule facts need them. */
export async function documentFacts(docs: DocumentRecord[]): Promise<DocumentFacts[]> {
  return Promise.all(
    docs.map(async (d) => {
      const [fields, checks] = await Promise.all([
        ExtractedFieldModel.find({ document: d._id }).lean(),
        ConsistencyCheckModel.find({ document: d._id }).lean(),
      ]);
      return {
        documentId: String(d._id),
        documentType: d.documentType ?? null,
        fields: Object.fromEntries(fields.map((f) => [f.key, { value: f.value ?? null, status: f.status, confidence: f.confidence?.overall ?? undefined }])),
        consistencyChecks: checks.map((c) => ({ code: c.code, status: c.status, expected: c.expected })),
        verificationStatus: (d.verification?.status ?? 'not_verified') as VerificationStatus,
      };
    }),
  );
}

/** M9 — builds facts from reviewed documents, evaluates the active rule version and stores an explainable recommendation. */
export async function evaluateApplication(applicationId: string, actorId?: string) {
  const app = await ApplicationModel.findById(applicationId);
  if (!app) return null;
  const [student, scholarship, rule] = await Promise.all([
    UserModel.findById(app.student).lean(),
    ScholarshipModel.findById(app.scholarship).lean(),
    ScholarshipRuleModel.findOne({ scholarship: app.scholarship, active: true }).sort({ version: -1 }).lean(),
  ]);
  if (!scholarship || !rule) throw new Error('Scholarship has no active rule set');

  const docs = await DocumentModel.find({ _id: { $in: app.documents }, status: { $nin: ['purged', 'rejected'] } }).lean();
  const docFacts = await documentFacts(docs);

  const { facts, provenance } = deriveFacts(student?.profile ?? {}, docFacts);
  const evaluation = evaluate(rule.root as unknown as RuleNode, facts, (await getSettings()).factText as FactText);
  const missingDocs = (scholarship.requiredDocuments ?? []).filter((t) => !docs.some((d) => d.documentType === t));
  let outcome: 'recommended' | 'not_recommended' | 'needs_review' = OUTCOME[evaluation.outcome];
  // Without every required document the decision cannot be made either way.
  if (missingDocs.length) outcome = 'needs_review';

  const authenticity = docs.map((d) => ({
    documentId: String(d._id),
    documentType: d.documentType,
    name: d.originalName,
    verificationStatus: d.verification?.status ?? 'not_verified',
    provider: d.verification?.providerLabel,
    ...authenticityStatement((d.verification?.status ?? 'not_verified') as VerificationStatus),
  }));

  const counts = { met: 0, notMet: 0, undetermined: 0 };
  const walk = (n: typeof evaluation) => {
    if (n.type === 'condition') counts[n.outcome === 'pass' ? 'met' : n.outcome === 'fail' ? 'notMet' : 'undetermined']++;
    n.children?.forEach(walk);
  };
  walk(evaluation);
  const summary = [
    outcome === 'recommended' ? 'Eligible under the scholarship rules.' : outcome === 'not_recommended' ? 'Not eligible under the scholarship rules.' : 'Eligibility cannot be decided yet.',
    `${counts.met} condition(s) met, ${counts.notMet} not met, ${counts.undetermined} undetermined.`,
    missingDocs.length ? `Missing required document(s): ${missingDocs.join(', ')}.` : '',
    authenticity.every((a) => a.established) ? '' : 'Authenticity of one or more documents has not been established by an issuing authority.',
  ].filter(Boolean).join(' ');

  const rec = await RecommendationModel.create({ application: app._id, ruleVersion: rule.version, outcome, summary, evaluation, facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, { value: v, ...provenance[k] }])), authenticity, generatedBy: actorId });

  app.latestRecommendation = rec._id;
  if (['submitted', 'under_review', 'evaluated'].includes(app.status)) app.status = outcome === 'needs_review' ? 'under_review' : 'evaluated';
  await app.save();
  await timeline({ application: app._id, stage: 'recommendation', status: outcome, message: summary, actor: actorId });
  await notify(app.student, 'recommendation_issued', `A recommendation was issued for ${scholarship.name}: ${outcome.replace('_', ' ')}.`, `/applications/${app.id}`);
  if (missingDocs.length) await notify(app.student, 'additional_document_needed', `${scholarship.name} needs: ${missingDocs.join(', ')}.`, `/applications/${app.id}`);
  return rec;
}
