export type Role = 'student' | 'verifier' | 'scholarship_officer' | 'admin';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
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
  classification?: { confidence?: number };
  stages: Stage[];
  verification: { status: string; providerLabel?: string; simulated?: boolean; checkedAt?: string };
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
  children?: NodeResult[];
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
