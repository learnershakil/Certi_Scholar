import { describe, expect, it } from "bun:test";
import {
  barFillPercent,
  checkSubjectMarkValidity,
  classifyNeedsReview,
  formatMarks,
  formatPercentage,
  formatSignedDifference,
  missingPrintedFields,
  printedMinusCalculated,
  subjectPercentage,
} from "../display";

describe("display helpers", () => {
  it("formats marks cleanly without trailing zeros", () => {
    expect(formatMarks(85)).toBe("85");
    expect(formatMarks(76.5)).toBe("76.5");
    expect(formatMarks(82.34)).toBe("82.34");
  });

  it("formats percentage with two decimals and percent sign", () => {
    expect(formatPercentage(76.25)).toBe("76.25%");
    expect(formatPercentage(100)).toBe("100.00%");
    expect(formatPercentage(0)).toBe("0.00%");
  });

  it("calculates subject percentage and clamped bar fill", () => {
    expect(subjectPercentage({ subject: "Math", obtained: 80, maximum: 100 })).toBe(80);
    expect(barFillPercent({ subject: "Math", obtained: 80, maximum: 100 })).toBe(80);
    expect(barFillPercent({ subject: "Bonus", obtained: 120, maximum: 100 })).toBe(100);
    expect(barFillPercent({ subject: "ZeroMax", obtained: 10, maximum: 0 })).toBe(0);
  });

  it("validates subject marks against academic rules", () => {
    expect(
      checkSubjectMarkValidity({ subject: "Math", obtained: 80, maximum: 100 }),
    ).toEqual({ valid: true });

    expect(
      checkSubjectMarkValidity({ subject: "Math", obtained: -5, maximum: 100 }),
    ).toEqual({
      valid: false,
      reason: "negative-marks",
      message: "Obtained marks cannot be negative",
    });

    expect(
      checkSubjectMarkValidity({ subject: "Math", obtained: 80, maximum: 0 }),
    ).toEqual({
      valid: false,
      reason: "invalid-maximum",
      message: "Maximum marks must be greater than 0",
    });

    expect(
      checkSubjectMarkValidity({ subject: "Math", obtained: 110, maximum: 100 }),
    ).toEqual({
      valid: false,
      reason: "exceeds-maximum",
      message: "Obtained marks cannot exceed maximum",
    });
  });

  it("computes difference and signed formatting", () => {
    expect(printedMinusCalculated(305, 305)).toBe(0);
    expect(printedMinusCalculated(310, 305)).toBe(5);
    expect(printedMinusCalculated(300, 305)).toBe(-5);
    expect(printedMinusCalculated(undefined, 305)).toBeUndefined();

    expect(formatSignedDifference(0)).toBe("0");
    expect(formatSignedDifference(5)).toBe("+5");
    expect(formatSignedDifference(-3.33)).toBe("-3.33");
  });

  it("detects missing printed fields", () => {
    expect(
      missingPrintedFields({
        subjects: [{ subject: "Math", obtained: 80, maximum: 100 }],
        printedTotal: 80,
      }),
    ).toEqual(["percentage"]);

    expect(
      missingPrintedFields({
        subjects: [{ subject: "Math", obtained: 80, maximum: 100 }],
      }),
    ).toEqual(["total", "percentage"]);
  });

  it("classifies NEEDS_REVIEW verdicts", () => {
    expect(
      classifyNeedsReview(
        { status: "CONSISTENT", issues: [] },
        { subjects: [] },
      ),
    ).toBeUndefined();

    expect(
      classifyNeedsReview(
        { status: "NEEDS_REVIEW", issues: ["Validation error"] },
        { subjects: [{ subject: "Math", obtained: 110, maximum: 100 }] },
      ),
    ).toBe("calculation-unavailable");

    expect(
      classifyNeedsReview(
        {
          status: "NEEDS_REVIEW",
          calculated: { totalObtained: 80, totalMaximum: 100, percentage: 80 },
          issues: [],
        },
        { subjects: [{ subject: "Math", obtained: 80, maximum: 100 }] },
      ),
    ).toBe("printed-values-missing");
  });

  it("correctly reconciles all 4 demo sample scenarios", async () => {
    const { runAcademicCheck } = await import("@repo/academic-engine");
    const { SAMPLE_RECORDS } = await import("../sample-records");

    // Sample 1: Consistent record
    const s1 = SAMPLE_RECORDS[0]!.record;
    const r1 = runAcademicCheck(s1);
    expect(r1.status).toBe("CONSISTENT");
    expect(r1.calculated).toEqual({
      totalObtained: 305,
      totalMaximum: 400,
      percentage: 76.25,
    });
    expect(printedMinusCalculated(s1.printedTotal, r1.calculated?.totalObtained)).toBe(0);
    expect(printedMinusCalculated(s1.printedPercentage, r1.calculated?.percentage)).toBe(0);

    // Sample 2: Inconsistent percentage
    const s2 = SAMPLE_RECORDS[1]!.record;
    const r2 = runAcademicCheck(s2);
    expect(r2.status).toBe("INCONSISTENT");
    expect(r2.calculated?.percentage).toBe(81.67);
    expect(printedMinusCalculated(s2.printedPercentage, r2.calculated?.percentage)).toBe(3.33);

    // Sample 3: Marks exceed maximum
    const s3 = SAMPLE_RECORDS[2]!.record;
    const r3 = runAcademicCheck(s3);
    expect(r3.status).toBe("NEEDS_REVIEW");
    expect(r3.calculated).toBeUndefined();
    expect(classifyNeedsReview(r3, s3)).toBe("calculation-unavailable");

    // Sample 4: Missing printed values
    const s4 = SAMPLE_RECORDS[3]!.record;
    const r4 = runAcademicCheck(s4);
    expect(r4.status).toBe("NEEDS_REVIEW");
    expect(r4.calculated).toEqual({
      totalObtained: 340,
      totalMaximum: 400,
      percentage: 85,
    });
    expect(missingPrintedFields(s4)).toEqual(["total", "percentage"]);
    expect(classifyNeedsReview(r4, s4)).toBe("printed-values-missing");
  });
});
