// --------------- VAIBHAV TYAGI WORK ----------------
import { z } from 'zod';

export const DocumentStatusSchema = z.enum([
  'new',
  'validating',
  'quarantined',
  'scanning',
  'rejected',
  'infected',
  'scan-error',
  'clean',
  'queued',
  'processing',
  'failed',
  'completed',
  'deleted',
  'missing'
]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const M1ToM2QueuePayloadSchema = z.object({
  version: z.literal("1.0"),
  documentId: z.string(),
  storageKey: z.string(),
  requestedType: z.string(),
  mimeType: z.string()
});

export type M1ToM2QueuePayload = z.infer<typeof M1ToM2QueuePayloadSchema>;
