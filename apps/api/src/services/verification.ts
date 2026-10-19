import { DocumentModel, ExtractedFieldModel, VerificationRequestModel, VerificationResultModel } from '../models/document.js';
import { getSettings } from '../models/system.js';
import { audit, notify, timeline, type Actor } from '../lib/events.js';
import { conflict, notFound } from '../lib/errors.js';
import { jobQueue, PermanentJobError, type JobContext } from '../pipeline/queue.js';
import { reevaluateApplicationsFor } from '../pipeline/documentPipeline.js';
import { authenticityStatement, ProviderConfigError, resolveProvider, statusFor, type ProviderResponse } from '../verification/providers.js';

export async function requestVerification(documentId: string, actor: Actor) {
  const doc = await DocumentModel.findById(documentId);
  if (!doc) throw notFound('Document');
  if (!doc.documentType || !['processed', 'needs_review'].includes(doc.status)) throw conflict('Document must be processed before verification');
  const settings = await getSettings();
  let provider;
  try {
    provider = resolveProvider(settings);
  } catch (err) {
    throw conflict((err as Error).message);
  }
  if (!provider) throw conflict('No automated verification provider is configured. Record a manual verification instead.');

  const req = await VerificationRequestModel.create({ document: doc._id, providerId: provider.id, providerLabel: provider.label, simulated: provider.simulated, requestedBy: actor.id });
  doc.verification = { status: 'pending', providerId: provider.id, providerLabel: provider.label, simulated: provider.simulated };
  await doc.save();
  await audit(actor, 'verification.requested', 'Document', doc._id, { provider: provider.id, simulated: provider.simulated });
  await timeline({ document: doc._id, stage: 'verify', status: 'requested', message: provider.label, actor: actor.id });
  await jobQueue().add('document.verify', { requestId: req.id }, { jobId: `verify:${req.id}` });
  return req;
}

export async function runVerification(requestId: string, ctx: JobContext) {
  const req = await VerificationRequestModel.findById(requestId);
  if (!req || req.status === 'completed') return; // idempotent
  const doc = await DocumentModel.findById(req.document);
  if (!doc) return;
  req.attempts += 1;
  let provider;
  try {
    provider = resolveProvider(await getSettings());
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      req.status = 'failed';
      req.error = err.message;
      await req.save();
      throw new PermanentJobError(err.message);
    }
    throw err;
  }
  if (!provider || provider.id !== req.providerId) {
    req.status = 'failed';
    req.error = 'Provider configuration changed since the request was made';
    await req.save();
    return;
  }

  const fields = await ExtractedFieldModel.find({ document: doc._id, status: { $ne: 'needs_review' } }).lean();
  let response: ProviderResponse;
  try {
    response = await provider.verify({ documentType: doc.documentType!, fields: Object.fromEntries(fields.map((f) => [f.key, f.value ?? null])) });
  } catch (err) {
    req.error = (err as Error).message;
    if (ctx.finalAttempt) {
      req.status = 'failed';
      doc.verification!.status = 'provider_error';
      await doc.save();
      await timeline({ document: doc._id, stage: 'verify', status: 'failed', message: `${req.error}. Fall back to manual verification.` });
    }
    await req.save();
    throw err;
  }

  const status = statusFor(response.outcome, provider.simulated ? 'simulated' : 'authority');
  await VerificationResultModel.create({
    request: req._id,
    document: doc._id,
    providerId: provider.id,
    providerLabel: provider.label,
    outcome: response.outcome,
    authoritative: !provider.simulated,
    simulated: provider.simulated,
    reference: response.reference,
    mismatches: response.mismatches,
  });
  req.status = 'completed';
  await req.save();
  doc.verification = { status, providerId: provider.id, providerLabel: provider.label, simulated: provider.simulated, checkedAt: new Date() };
  await doc.save();
  await timeline({ document: doc._id, stage: 'verify', status, message: authenticityStatement(status).text });
  await notify(doc.owner, 'verification_outcome', `Verification of "${doc.originalName}": ${authenticityStatement(status).text}`, `/documents/${doc.id}`);
  await reevaluateApplicationsFor(doc._id);
}

/** An officer records the outcome of contacting the issuing authority directly (the documented fallback for every adapter). */
export async function recordManualVerification(documentId: string, actor: Actor, outcome: 'match' | 'mismatch', note: string) {
  const doc = await DocumentModel.findById(documentId);
  if (!doc) throw notFound('Document');
  const status = statusFor(outcome, 'manual');
  const result = await VerificationResultModel.create({ document: doc._id, providerId: 'manual', providerLabel: 'Manual verification by officer', outcome, authoritative: true, simulated: false, note, actor: actor.id });
  doc.verification = { status, providerId: 'manual', providerLabel: 'Manual verification by officer', simulated: false, checkedAt: new Date() };
  await doc.save();
  await audit(actor, 'verification.manual', 'Document', doc._id, { outcome, note });
  await timeline({ document: doc._id, stage: 'verify', status, message: note, actor: actor.id });
  await notify(doc.owner, 'verification_outcome', `Verification of "${doc.originalName}": ${authenticityStatement(status).text}`, `/documents/${doc.id}`);
  await reevaluateApplicationsFor(doc._id);
  return result;
}
