import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

export const STAGES = ['scan', 'ocr', 'classify', 'extract', 'consistency'] as const;
export type StageName = (typeof STAGES)[number];
export const STAGE_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

export const DOCUMENT_STATUSES = ['queued', 'processing', 'needs_review', 'processed', 'failed', 'rejected', 'purged'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Verification states. Only `authority_*` and `manual_*` come from an authorised source. */
export const VERIFICATION_STATUSES = [
  'not_verified',
  'pending',
  'authority_match',
  'authority_mismatch',
  'authority_not_found',
  'simulated_match',
  'simulated_mismatch',
  'manual_match',
  'manual_mismatch',
  'provider_error',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

const DocumentTypeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    keywords: [{ _id: false, term: String, weight: Number }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const ProfileFieldSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    kind: { type: String, enum: ['text', 'number', 'date', 'id'], default: 'text' },
    /** Regex with exactly one capture group for the value, matched line by line. */
    pattern: { type: String, required: true },
    required: { type: Boolean, default: true },
    /** Overrides the global confidence threshold for this field. */
    threshold: Number,
  },
  { _id: false },
);

const ExtractionProfileSchema = new Schema(
  {
    documentType: { type: String, required: true, index: true },
    /** One document type can have several real-world layouts (e.g. a state board and ICSE marksheet). */
    format: { type: String, required: true, default: 'standard' },
    name: String,
    version: { type: Number, required: true },
    active: { type: Boolean, default: true },
    fields: [ProfileFieldSchema],
    table: {
      key: String,
      label: String,
      /** Regex with one capture group per column. */
      rowPattern: String,
      /** `fixed` = a value set by the format itself (e.g. every ICSE subject is out of 100), not read by OCR. */
      columns: [{ _id: false, key: String, kind: { type: String, enum: ['text', 'number'] }, fixed: String }],
    },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
ExtractionProfileSchema.index({ documentType: 1, format: 1, version: -1 }, { unique: true });

const StageSchema = new Schema(
  {
    name: { type: String, enum: STAGES, required: true },
    status: { type: String, enum: STAGE_STATUSES, default: 'pending' },
    attempts: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date,
    error: String,
  },
  { _id: false },
);

const DocumentSchema = new Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true },
    mime: { type: String, required: true },
    size: Number,
    sha256: { type: String, index: true },
    storageKey: String,
    previewKey: String,
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'queued', index: true },
    stages: [StageSchema],
    documentType: { type: String, default: null },
    declaredType: String, // chosen by the student at upload; used only when keywords are not conclusive
    classification: {
      confidence: Number,
      scores: Mixed,
      source: { type: String, enum: ['keywords', 'declared', 'officer'] },
      overriddenBy: { type: ObjectId, ref: 'User' },
    },
    profileFormat: String,
    profileVersion: Number,
    ocr: { type: Mixed, select: false },
    ocrProvider: String,
    assignedTo: { type: ObjectId, ref: 'User', index: true },
    reviewCompletedAt: Date,
    // A verifier's decision that this is not a usable document (wrong document, unreadable, not the applicant's).
    rejection: { reason: String, at: Date, by: { type: ObjectId, ref: 'User' } },
    reviewedBy: { type: ObjectId, ref: 'User' },
    verification: {
      status: { type: String, enum: VERIFICATION_STATUSES, default: 'not_verified' },
      providerId: String,
      providerLabel: String,
      simulated: Boolean,
      checkedAt: Date,
    },
    retainUntil: { type: Date, index: true },
    purgedAt: Date,
  },
  { timestamps: true },
);

export const ConfidenceScoreSchema = new Schema(
  {
    ocr: Number, // min OCR word confidence of the value tokens
    pattern: Number, // 1 if the value parses as the declared kind, else 0
    overall: Number,
    threshold: Number,
  },
  { _id: false },
);

export const FIELD_STATUSES = ['auto_accepted', 'needs_review', 'confirmed', 'corrected'] as const;

const ExtractedFieldSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    key: { type: String, required: true },
    label: String,
    kind: String,
    group: String,
    row: Number,
    value: { type: String, default: null },
    page: { type: Number, default: 0 },
    bbox: { type: [Number], default: undefined }, // normalised [x0, y0, x1, y1]
    confidence: ConfidenceScoreSchema,
    status: { type: String, enum: FIELD_STATUSES, required: true },
    required: Boolean,
  },
  { timestamps: true },
);
ExtractedFieldSchema.index({ document: 1, key: 1 }, { unique: true });

const CorrectionSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    fieldKey: { type: String, required: true },
    documentType: String,
    previousValue: String,
    newValue: String,
    previousConfidence: Number,
    reason: { type: String, required: true },
    actor: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

const ConsistencyCheckSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    code: { type: String, required: true },
    label: String,
    status: { type: String, enum: ['pass', 'fail', 'not_applicable'], required: true },
    expected: Mixed,
    actual: Mixed,
    message: String,
  },
  { timestamps: true },
);

const VerificationRequestSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    providerId: { type: String, required: true },
    providerLabel: String,
    simulated: { type: Boolean, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    requestedBy: { type: ObjectId, ref: 'User' },
    attempts: { type: Number, default: 0 },
    error: String,
  },
  { timestamps: true },
);

const VerificationResultSchema = new Schema(
  {
    request: { type: ObjectId, ref: 'VerificationRequest' },
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    providerId: String,
    providerLabel: String,
    outcome: { type: String, enum: ['match', 'mismatch', 'not_found'], required: true },
    /** True only when an authorised issuing authority (or an officer contacting one) responded. */
    authoritative: { type: Boolean, required: true },
    simulated: { type: Boolean, required: true },
    reference: String,
    mismatches: [{ _id: false, field: String, submitted: String, authority: String }],
    note: String,
    actor: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const DocumentTypeModel = model('DocumentType', DocumentTypeSchema);
export const ExtractionProfileModel = model('ExtractionProfile', ExtractionProfileSchema);
export const DocumentModel = model('Document', DocumentSchema);
export const ExtractedFieldModel = model('ExtractedField', ExtractedFieldSchema);
export const CorrectionModel = model('Correction', CorrectionSchema);
export const ConsistencyCheckModel = model('ConsistencyCheck', ConsistencyCheckSchema);
export const VerificationRequestModel = model('VerificationRequest', VerificationRequestSchema);
export const VerificationResultModel = model('VerificationResult', VerificationResultSchema);

export type DocumentRecord = HydratedDocument<InferSchemaType<typeof DocumentSchema>>;
export type ExtractionProfile = InferSchemaType<typeof ExtractionProfileSchema>;
export type ExtractedField = InferSchemaType<typeof ExtractedFieldSchema> & { _id: Types.ObjectId };
