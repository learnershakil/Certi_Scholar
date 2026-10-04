import { Redis } from "ioredis";

/** BullMQ queue names. Confirm these with the M2, M4 and M5 owners. */
export const QUEUES = {
  CLASSIFICATION: "classification", // consumed by M3 (produced by M2)
  EXTRACTION: "extraction", // consumed by M4 (produced by M3)
  REVIEW: "review", // consumed by M5 (produced by M3 when needs_review)
  TIMELINE: "timeline", // consumed by M10
} as const;

/** BullMQ workers require maxRetriesPerRequest: null. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
