export interface DocTypeDef {
  code: string;
  name: string;
}

export type Role = 'student' | 'verifier' | 'scholarship_officer' | 'admin';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** False for a student whose gender or state is not set yet; they are sent to their profile first. */
  profileComplete?: boolean;
  /** Only on the sign-in response: this account has never signed in before. */
  firstLogin?: boolean;
}

export interface Stage {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempts: number;
  error?: string;
}

export interface Authenticity {
  established: boolean;
  text: string;
}

export interface DocumentSummary {
  id: string;
  originalName: string;
  mime: string;
  status: string;
  documentType: string | null;
  classification?: { confidence?: number; source?: 'keywords' | 'declared' | 'officer' };
  declaredType?: string;
  profileFormat?: string;
  stages: Stage[];
  verification: { status: string; providerLabel?: string; simulated?: boolean; checkedAt?: string };
  /** Set when a verifier rejected the document; the student sees the reason. */
  rejection?: { reason: string; at: string };
  authenticity: Authenticity;
  assignedTo?: string | null;
  createdAt: string;
}

export interface ConsistencyCheck {
  _id: string;
  code: string;
  label: string;
  status: 'pass' | 'fail' | 'not_applicable';
  message: string;
}

export interface VerificationResult {
  _id: string;
  providerLabel: string;
  outcome: string;
  authoritative: boolean;
  simulated: boolean;
  reference?: string;
  note?: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  consistencyChecks: ConsistencyCheck[];
  verificationResults: VerificationResult[];
}

export interface ExtractedField {
  _id: string;
  key: string;
  label: string;
  kind: string;
  group?: string;
  row?: number;
  value: string | null;
  page: number;
  bbox?: [number, number, number, number];
  confidence: { ocr: number; pattern: number; overall: number; threshold: number };
  status: 'auto_accepted' | 'needs_review' | 'confirmed' | 'corrected';
}

export interface TimelineEntry {
  _id: string;
  stage: string;
  status: string;
  message?: string;
  durationMs?: number;
  actor?: { name: string; role: string } | null;
  document?: { originalName: string } | null;
  createdAt: string;
}

export type RuleNode =
  | { type: 'group'; op: 'AND' | 'OR'; label?: string; children: RuleNode[] }
  | { type: 'condition'; fact: string; operator: string; value?: unknown; label?: string };

export interface NodeResult {
  type: 'group' | 'condition';
  label: string;
  outcome: 'pass' | 'fail' | 'unknown';
  reason: string;
  op?: 'AND' | 'OR';
  fact?: string;
  /** The value the condition was checked against, when one was available. */
  actual?: unknown;
  children?: NodeResult[];
}

/** An open scholarship as the student dashboard shows it; criteria are checked against the profile only. */
export interface ScholarshipOverview {
  _id: string;
  code: string;
  name: string;
  description?: string;
  sponsor?: string;
  amount?: number;
  deadline?: string;
  requiredDocuments: string[];
  ruleVersion: number | null;
  criteria: NodeResult | null;
}

export interface FactDefinition {
  label: string;
  type: 'number' | 'boolean' | 'enum' | 'string';
  options?: string[];
  description: string;
}

export interface Scholarship {
  _id: string;
  code: string;
  name: string;
  description?: string;
  sponsor?: string;
  amount?: number;
  requiredDocuments: string[];
  active: boolean;
}

export interface Recommendation {
  _id: string;
  outcome: 'recommended' | 'not_recommended' | 'needs_review';
  summary: string;
  ruleVersion: number;
  evaluation: NodeResult;
  facts: Record<string, { value: unknown; source: string; note?: string; confidence?: number; fieldStatus?: string }>;
  authenticity: Array<Authenticity & { documentId: string; name: string; documentType: string | null; verificationStatus: string; provider?: string }>;
  createdAt: string;
}

export interface Application {
  _id: string;
  status: string;
  student: { _id: string; name: string; email: string; profile?: Record<string, string> };
  scholarship: { _id: string; name: string; code: string; amount?: number; requiredDocuments?: string[] };
  documents: Array<{ _id: string; originalName: string; documentType: string | null; status: string; verification?: { status: string } }> | string[];
  latestRecommendation?: { outcome: string; summary: string; createdAt: string };
  decision?: { outcome: string; note: string; at: string };
  createdAt: string;
}
