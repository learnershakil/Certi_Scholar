import type {
  AcademicEngineResult,
  AcademicRecord,
} from "@repo/academic-engine";

/**
 * Where a record came from. Only "demo" is produced today.
 * "upstream" is reserved for the future M4/M5 integration and must only
 * be set by code that actually receives data from that module.
 */
export type RecordSource = "demo" | "upstream";

/** A record plus the metadata the UI needs. The marks themselves are read-only. */
export interface RecordEnvelope {
  /** Stable identifier. Used to detect stale results. */
  id: string;
  /** Human-readable record name shown in the page header. */
  label: string;
  source: RecordSource;
  /** What a demo record is designed to illustrate. Not an engine verdict. */
  note?: string;
  record: AcademicRecord;
}

export type EngineStatus = AcademicEngineResult["status"];

export type CheckErrorKind = "invalid-request" | "server" | "network";

/**
 * The state of the most recent check request.
 * `phase` decides which other fields exist.
 */
export type CheckState =
  | { phase: "idle" }
  | { phase: "loading"; recordId: string }
  | {
      phase: "success";
      recordId: string;
      result: AcademicEngineResult;
      /** ISO timestamp taken when the response arrived. */
      checkedAt: string;
    }
  | {
      phase: "error";
      recordId: string;
      kind: CheckErrorKind;
      message: string;
      details?: string[];
    };

export type SubjectValidationStatus =
  | { valid: true }
  | {
      valid: false;
      reason: "negative-marks" | "invalid-maximum" | "exceeds-maximum";
      message: string;
    };

/** One row of the in-memory "Recent checks this session" list. */
export interface HistoryEntry {
  key: string;
  recordId: string;
  recordLabel: string;
  checkedAt: string;
  status: EngineStatus;
  subjectCount: number;
  /** The engine's returned issue messages, unchanged. */
  issues: string[];
  /** Recalculated percentage from the engine, if available. */
  recalculatedPercentage?: number;
  totalObtained?: number;
  totalMaximum?: number;
}