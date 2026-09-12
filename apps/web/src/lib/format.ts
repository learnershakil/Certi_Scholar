export const DOC_TYPE_LABEL: Record<string, string> = {
  marksheet: 'Statement of marks',
  income_certificate: 'Income certificate',
  identity: 'Identity document',
};

export const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  verifier: 'Verification officer',
  scholarship_officer: 'Scholarship officer',
  admin: 'Administrator',
};

export const humanize = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

export const docType = (t?: string | null) => (t ? DOC_TYPE_LABEL[t] ?? humanize(t) : 'Unclassified');

export const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const pct = (n?: number) => (n === undefined || n === null ? '—' : `${Math.round(n * 100)}%`);

export const inr = (n?: number) => (n === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<string, Tone> = {
  queued: 'neutral',
  processing: 'info',
  needs_review: 'warning',
  processed: 'success',
  failed: 'danger',
  rejected: 'danger',
  purged: 'neutral',
  submitted: 'neutral',
  under_review: 'warning',
  evaluated: 'info',
  awarded: 'success',
  recommended: 'success',
  not_recommended: 'danger',
  pass: 'success',
  fail: 'danger',
  unknown: 'warning',
  not_applicable: 'neutral',
  auto_accepted: 'success',
  confirmed: 'success',
  corrected: 'info',
  authority_match: 'success',
  manual_match: 'success',
  authority_mismatch: 'danger',
  manual_mismatch: 'danger',
  authority_not_found: 'danger',
  simulated_match: 'warning',
  simulated_mismatch: 'warning',
  provider_error: 'danger',
  pending: 'info',
  not_verified: 'neutral',
};
