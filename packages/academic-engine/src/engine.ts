import type { AcademicRecord } from "./types";
import { validateSubjectMarks } from "./validation";
import { calculateAcademicResult } from "./calculation";
import { checkConsistency } from "./consistency";

export interface AcademicEngineResult {
  status: "CONSISTENT" | "INCONSISTENT" | "NEEDS_REVIEW";
  calculated?: {
    totalObtained: number;
    totalMaximum: number;
    percentage: number;
  };
  issues: string[];
}

export function runAcademicCheck(
  record: AcademicRecord,
): AcademicEngineResult {
  const validationErrors = validateSubjectMarks(record.subjects);

  if (validationErrors.length > 0) {
    return {
      status: "NEEDS_REVIEW",
      issues: validationErrors,
    };
  }

  const calculated = calculateAcademicResult(record.subjects);

  const consistency = checkConsistency(calculated, {
    total: record.printedTotal,
    percentage: record.printedPercentage,
  });

  return {
    status: consistency.status,
    calculated,
    issues: consistency.issues.map((issue) => issue.message),
  };
}