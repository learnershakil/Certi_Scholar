import mongoose, { Schema, type InferSchemaType } from "mongoose";

const documentTypeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    keywords: [{ _id: false, term: String, weight: Number }],
    regexPatterns: [{ _id: false, pattern: String, weight: Number }],
    minConfidence: { type: Number, default: 0.4 },
    extractionProfileId: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "documentTypes" },
);

const classificationSchema = new Schema(
  {
    documentId: { type: String, required: true, unique: true }, // one row per document => idempotent
    status: { type: String, enum: ["classified", "needs_review"], required: true },
    source: { type: String, enum: ["auto", "manual"], default: "auto" },
    documentTypeCode: { type: String, default: null },
    extractionProfileId: { type: String, default: null },
    confidence: { type: Number, required: true },
    candidates: [{ _id: false, code: String, score: Number }],
    evidence: [String],
    reason: { type: String, default: null },
    classifierVersion: { type: String, required: true },
    reviewedBy: { type: String, default: null },
    reviewNote: { type: String, default: null },
  },
  { timestamps: true, collection: "classifications" },
);

export type DocumentTypeDoc = InferSchemaType<typeof documentTypeSchema>;
export type ClassificationDoc = InferSchemaType<typeof classificationSchema>;

// Reuse compiled models if the module is imported twice (hot reload, monorepo hoisting).
export const DocumentTypeModel =
  (mongoose.models["DocumentType"] as mongoose.Model<DocumentTypeDoc>) ??
  mongoose.model<DocumentTypeDoc>("DocumentType", documentTypeSchema);

export const ClassificationModel =
  (mongoose.models["Classification"] as mongoose.Model<ClassificationDoc>) ??
  mongoose.model<ClassificationDoc>("Classification", classificationSchema);
