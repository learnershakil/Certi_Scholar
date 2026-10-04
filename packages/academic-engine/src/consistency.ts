import type { CalculationResult } from "./calculation";

export interface ConsistencyIssue {
  field: "total" | "percentage";
  calculated: number;
  printed?: number;
  message: string;
}

export interface ConsistencyResult {
  status: "CONSISTENT" | "INCONSISTENT" | "NEEDS_REVIEW";
  issues: ConsistencyIssue[];
}

export interface PrintedValues {
  total?: number;
  percentage?: number;
}

export function checkConsistency(
  calculated: CalculationResult,
  printed: PrintedValues,
  tolerance = 0.01,
): ConsistencyResult {
  const issues: ConsistencyIssue[] = [];

  if (printed.total === undefined && printed.percentage === undefined) {
    return {
      status: "NEEDS_REVIEW",
      issues: [],
    };
  }

  if (
    printed.total !== undefined &&
    Math.abs(calculated.totalObtained - printed.total) > tolerance
  ) {
    issues.push({
      field: "total",
      calculated: calculated.totalObtained,
      printed: printed.total,
      message: "Printed total does not match calculated total.",
    });
  }

  if (
    printed.percentage !== undefined &&
    Math.abs(calculated.percentage - printed.percentage) > tolerance
  ) {
    issues.push({
      field: "percentage",
      calculated: calculated.percentage,
      printed: printed.percentage,
      message: "Printed percentage does not match calculated percentage.",
    });
  }

  if (issues.length > 0) {
    return {
      status: "INCONSISTENT",
      issues,
    };
  }

  if (printed.total === undefined || printed.percentage === undefined) {
    return {
      status: "NEEDS_REVIEW",
      issues,
    };
  }

  return {
    status: "CONSISTENT",
    issues: [],
  };
}