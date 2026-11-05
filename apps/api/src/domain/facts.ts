import type { VerificationStatus } from '../models/document.js';

export type FactType = 'number' | 'boolean' | 'enum' | 'string';

export interface FactDefinition {
  type: FactType;
  options?: string[];
}

/** Labels and descriptions shown for each fact; stored in Settings and edited by administrators. */
export type FactText = Record<string, { label?: string; description?: string }>;

/**
 * The facts the rule builder offers and how each may be compared. Adding a fact is a code change because
 * deriveFacts() must compute it; what a fact is called is not (see FactText).
 */
export const FACT_CATALOG: Record<string, FactDefinition> = {
  'applicant.gender': { type: 'enum', options: ['female', 'male', 'other'] },
  'applicant.state': { type: 'string' },
  'marksheet.percentage': { type: 'number' },
  'marksheet.examYear': { type: 'number' },
  'marksheet.consistent': { type: 'boolean' },
  'income.annualIncome': { type: 'number' },
  'identity.provided': { type: 'boolean' },
  'documents.reviewComplete': { type: 'boolean' },
  'documents.authenticityEstablished': { type: 'boolean' },
};

/** Catalog with its current wording, for the rule builder. A fact without a label shows its key. */
export const describeFacts = (text: FactText = {}) =>
  Object.fromEntries(
    Object.entries(FACT_CATALOG).map(([key, def]) => [key, { ...def, label: text[key]?.label || key, description: text[key]?.description ?? '' }]),
  );

export interface DocumentFacts {
  documentId: string;
  documentType: string | null;
  fields: Record<string, { value: string | null; status: string; confidence?: number }>;
  consistencyChecks: Array<{ code: string; status: string; expected?: unknown }>;
  verificationStatus: VerificationStatus;
}

export interface Provenance {
  source: string;
  documentId?: string;
  fieldStatus?: string;
  confidence?: number;
  note?: string;
}

const num = (v: string | null | undefined) => {
  if (v === null || v === undefined) return null;
  const n = Number(v.replace(/[,₹\s]/g, '').replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
};

const usable = (f?: { value: string | null; status: string }) => (f && f.status !== 'needs_review' ? f.value : null);

/**
 * Derives rule facts from reviewed document data. Fields still awaiting review are deliberately
 * withheld so a low-confidence guess can never decide eligibility.
 */
export function deriveFacts(profile: { gender?: string | null; state?: string | null }, docs: DocumentFacts[]) {
  const facts: Record<string, unknown> = {};
  const provenance: Record<string, Provenance> = {};
  const set = (k: string, v: unknown, p: Provenance) => {
    if (v === null || v === undefined) return;
    facts[k] = v;
    provenance[k] = p;
  };

  set('applicant.gender', profile.gender, { source: 'Applicant profile (self-declared)' });
  set('applicant.state', profile.state, { source: 'Applicant profile (self-declared)' });

  const marksheet = docs.find((d) => d.documentType === 'marksheet');
  if (marksheet) {
    const pctCheck = marksheet.consistencyChecks.find((c) => c.code === 'percentage_matches_marks');
    const recomputed = typeof pctCheck?.expected === 'number' ? pctCheck.expected : null;
    const printed = num(usable(marksheet.fields.percentage));
    if (recomputed !== null) {
      set('marksheet.percentage', recomputed, {
        source: 'Recomputed from subject marks',
        documentId: marksheet.documentId,
        note: printed !== null && Math.abs(printed - recomputed) > 0.05 ? `Printed value ${printed} disagrees` : undefined,
      });
    } else {
      set('marksheet.percentage', printed, { source: 'Printed percentage', documentId: marksheet.documentId, fieldStatus: marksheet.fields.percentage?.status, confidence: marksheet.fields.percentage?.confidence });
    }
    set('marksheet.examYear', num(usable(marksheet.fields.exam_year)), { source: 'Marksheet: year of examination', documentId: marksheet.documentId });
    const applicable = marksheet.consistencyChecks.filter((c) => c.status !== 'not_applicable');
    if (applicable.length) {
      set('marksheet.consistent', applicable.every((c) => c.status === 'pass'), { source: `${applicable.length} consistency checks`, documentId: marksheet.documentId });
    }
  }

  const income = docs.find((d) => d.documentType === 'income_certificate');
  if (income) {
    set('income.annualIncome', num(usable(income.fields.annual_income)), {
      source: 'Income certificate: annual income',
      documentId: income.documentId,
      fieldStatus: income.fields.annual_income?.status,
      confidence: income.fields.annual_income?.confidence,
    });
  }

  set('identity.provided', docs.some((d) => d.documentType === 'identity'), { source: 'Attached documents' });

  if (docs.length) {
    set('documents.reviewComplete', docs.every((d) => Object.values(d.fields).every((f) => f.status !== 'needs_review')), { source: 'Field review status' });
    set('documents.authenticityEstablished', docs.every((d) => ['authority_match', 'manual_match'].includes(d.verificationStatus)), {
      source: 'Verification results from authorised sources',
    });
  }

  return { facts, provenance };
}
