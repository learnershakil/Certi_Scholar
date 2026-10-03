// Plain types with no runtime dependencies, so the classifier stays trivially testable.

export interface WeightedKeyword {
  term: string;
  weight: number;
}

export interface WeightedPattern {
  pattern: string;
  weight: number;
}

export interface DocumentTypeDef {
  code: string; // e.g. "MARKSHEET", "ID_AADHAAR", "INCOME_CERT"
  name: string;
  keywords: WeightedKeyword[];
  regexPatterns: WeightedPattern[];
  /** Minimum score (0..1) the top candidate needs to be accepted automatically. */
  minConfidence: number;
  /** Which M4 extraction profile handles this type. Null until an admin links one. */
  extractionProfileId: string | null;
  active: boolean;
}

export type ReviewReason =
  | "empty_text"
  | "no_document_types"
  | "low_confidence"
  | "ambiguous";

export interface Candidate {
  code: string;
  score: number;
}

export interface ClassificationResult {
  status: "classified" | "needs_review";
  documentTypeCode: string | null;
  extractionProfileId: string | null;
  confidence: number;
  candidates: Candidate[];
  /** Matched keywords / patterns for the top candidate, for explainability. */
  evidence: string[];
  /** Why the document was routed to review. Null when classified. */
  reason: ReviewReason | null;
}

export interface DocumentClassifier {
  readonly version: string;
  classify(
    input: { text: string },
    types: DocumentTypeDef[],
  ): Promise<ClassificationResult>;
}
