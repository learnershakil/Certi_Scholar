import type { SubjectMark } from "./types";

export interface CalculationResult {
  totalObtained: number;
  totalMaximum: number;
  percentage: number;
}

export function calculateAcademicResult(
  subjects: SubjectMark[],
): CalculationResult {
  let totalObtained = 0;
  let totalMaximum = 0;

  for (const subject of subjects) {
    totalObtained += subject.obtained;
    totalMaximum += subject.maximum;
  }

  const percentage = (totalObtained / totalMaximum) * 100;

  return {
    totalObtained,
    totalMaximum,
    percentage: Number(percentage.toFixed(2)),
  };
}