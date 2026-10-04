/**
 * Contracts for M3. Kept inside this module for now; when the team creates a
 * shared contracts package, move this file there unchanged and re-export it.
 */
import { z } from "zod";

// ---------- Input from M2 (OCR) ----------
export const OcrCompletedEvent = z.object({
  version: z.literal("1"),
  documentId: z.string().min(1),
  text: z.string(),
  pages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        text: z.string(),
        meanConfidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
});
export type OcrCompletedEvent = z.infer<typeof OcrCompletedEvent>;

// ---------- Output to M4 (extraction) / M5 (review) ----------
export const ClassificationCompletedEvent = z.object({
  version: z.literal("1"),
  documentId: z.string(),
  status: z.enum(["classified", "needs_review"]),
  source: z.enum(["auto", "manual"]),
  documentTypeCode: z.string().nullable(),
  extractionProfileId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  candidates: z.array(z.object({ code: z.string(), score: z.number() })),
  evidence: z.array(z.string()),
  reason: z
    .enum([
      "empty_text",
      "no_document_types",
      "low_confidence",
      "ambiguous",
      "no_anchor",
      "excluded_term",
    ])
    .nullable(),
  classifierVersion: z.string(),
});
export type ClassificationCompletedEvent = z.infer<typeof ClassificationCompletedEvent>;

// ---------- Hook for M10 (timeline). Every module emits these. ----------
export const TimelineEvent = z.object({
  version: z.literal("1"),
  documentId: z.string(),
  stage: z.string(), // "classification", "ocr", "extraction", ...
  status: z.enum(["started", "completed", "needs_review", "failed"]),
  actor: z.object({ type: z.enum(["system", "user"]), id: z.string() }),
  timestamp: z.string().datetime(),
  meta: z.record(z.unknown()).optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

// ---------- Admin API bodies ----------
const regexString = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) => {
      try {
        new RegExp(p, "i");
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid regular expression" },
  );

export const DocumentTypeInput = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Use UPPER_SNAKE_CASE"),
  name: z.string().min(1),
  keywords: z.array(z.object({ term: z.string().min(1), weight: z.number().positive() })),
  regexPatterns: z
    .array(z.object({ pattern: regexString, weight: z.number().positive() }))
    .default([]),
  anchorTerms: z.array(z.string().min(1)).default([]),
  excludeTerms: z.array(z.string().min(1)).default([]),
  minConfidence: z.number().min(0).max(1).default(0.4),
  extractionProfileId: z.string().nullable().default(null),
  active: z.boolean().default(true),
});
export type DocumentTypeInput = z.infer<typeof DocumentTypeInput>;

export const ClassifyRequest = z.object({
  /** Optional: OCR text. If omitted, the injected OcrTextProvider (M2) is used. */
  text: z.string().optional(),
  /** Re-run even if a reviewer already set the type manually. */
  force: z.boolean().default(false),
});

export const ManualClassificationRequest = z.object({
  documentTypeCode: z.string().min(1),
  actorId: z.string().min(1), // replace with the authenticated user once auth exists
  reason: z.string().optional(),
});
