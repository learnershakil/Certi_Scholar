import {
  runAcademicCheck,
  type AcademicEngineResult,
  type AcademicRecord,
} from "@repo/academic-engine";
import type { CheckErrorKind } from "./types";

export type CheckRequestOutcome =
  | { ok: true; result: AcademicEngineResult }
  | {
      ok: false;
      kind: CheckErrorKind;
      message: string;
      details?: string[];
    };

/**
 * Runs the academic check using the authoritative runAcademicCheck() engine function.
 * Executes on the loaded academic record and returns the true engine outcome.
 */
export async function requestAcademicCheck(
  record: AcademicRecord,
): Promise<CheckRequestOutcome> {
  try {
    const result = runAcademicCheck(record);
    return { ok: true, result };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "The academic check could not be completed.";
    return {
      ok: false,
      kind: "server",
      message,
    };
  }
}