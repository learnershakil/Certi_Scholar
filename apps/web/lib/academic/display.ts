import type {
  AcademicEngineResult,
  AcademicRecord,
  SubjectMark,
} from "@repo/academic-engine";
import type { SubjectValidationStatus } from "./types";

/**
 * DISPLAY-ONLY helpers.
 *
 * Nothing in this file is authoritative. The engine's returned status,
 * calculated totals, percentage and issues are the only verdicts.
 * These helpers only format values or compute explanatory numbers
 * (subject percentages, printed-minus-calculated differences).
 */

// ---------- Number formatting ----------

/** Marks with up to two decimals and no trailing zeros: 85 -> "85", 76.5 -> "76.5". */
export function formatMarks(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** Percentages always show two decimals, matching the engine's rounding. */
export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

// ---------- Subject-level display values ----------

/**
 * Display-only subject percentage. Returns undefined when the maximum
 * does not permit a calculation. NOT an engine verdict.
 */
export function subjectPercentage(mark: SubjectMark): number | undefined {
  if (!(mark.maximum > 0)) {
    return undefined;
  }
  return (mark.obtained / mark.maximum) * 100;
}

/** Bar fill for the obtained-versus-maximum chart, clamped to 0-100. */
export function barFillPercent(mark: SubjectMark): number {
  const percentage = subjectPercentage(mark);
  if (percentage === undefined) {
    return 0;
  }
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Evaluates whether a subject mark complies with the academic engine's validation rules:
 * 1. obtained marks cannot be negative
 * 2. maximum marks must be greater than 0
 * 3. obtained marks cannot be greater than maximum marks
 */
export function checkSubjectMarkValidity(
  mark: SubjectMark,
): SubjectValidationStatus {
  if (mark.obtained < 0) {
    return {
      valid: false,
      reason: "negative-marks",
      message: "Obtained marks cannot be negative",
    };
  }
  if (mark.maximum <= 0) {
    return {
      valid: false,
      reason: "invalid-maximum",
      message: "Maximum marks must be greater than 0",
    };
  }
  if (mark.obtained > mark.maximum) {
    return {
      valid: false,
      reason: "exceeds-maximum",
      message: "Obtained marks cannot exceed maximum",
    };
  }
  return { valid: true };
}

// ---------- Printed versus calculated ----------

/**
 * Display-only difference, defined as PRINTED minus CALCULATED.
 * Returns undefined unless both values exist.
 */
export function printedMinusCalculated(
  printed: number | undefined,
  calculated: number | undefined,
): number | undefined {
  if (printed === undefined || calculated === undefined) {
    return undefined;
  }
  return Number((printed - calculated).toFixed(4));
}

export function formatSignedDifference(difference: number): string {
  if (difference === 0) {
    return "0";
  }
  const sign = difference > 0 ? "+" : "-";
  return `${sign}${Math.abs(difference)}`;
}

// ---------- UI-derived explanations (NOT engine output) ----------

export type PrintedField = "total" | "percentage";

/** Which printed values the record did not supply. Read from the input, not the engine. */
export function missingPrintedFields(record: AcademicRecord): PrintedField[] {
  const missing: PrintedField[] = [];
  if (record.printedTotal === undefined) {
    missing.push("total");
  }
  if (record.printedPercentage === undefined) {
    missing.push("percentage");
  }
  return missing;
}

export type NeedsReviewKind =
  | "calculation-unavailable"
  | "printed-values-missing"
  | "unspecified";

/**
 * Explains a NEEDS_REVIEW result from what is present, not from engine
 * wording. Returns undefined for any other status.
 *
 * - No `calculated` object: the engine returned validation messages only.
 * - `calculated` present and a printed value absent from the input: the
 *   UI explains that printed values were not supplied.
 */
export function classifyNeedsReview(
  result: AcademicEngineResult,
  record: AcademicRecord,
): NeedsReviewKind | undefined {
  if (result.status !== "NEEDS_REVIEW") {
    return undefined;
  }
  if (result.calculated === undefined) {
    return "calculation-unavailable";
  }
  if (missingPrintedFields(record).length > 0) {
    return "printed-values-missing";
  }
  return "unspecified";
}

// ---------- Time ----------

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}