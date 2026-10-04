import { describe, expect, test } from "bun:test";
import { runAcademicCheck } from "../src";

describe("Academic Engine", () => {
  test("runs the complete academic calculation and consistency flow", () => {
    const result = runAcademicCheck({
      subjects: [
        { subject: "Mathematics", obtained: 85, maximum: 100 },
        { subject: "Physics", obtained: 78, maximum: 100 },
        { subject: "Computer Science", obtained: 82, maximum: 100 },
      ],
      printedTotal: 245,
      printedPercentage: 81.67,
    });

    expect(result.status).toBe("CONSISTENT");

    expect(result.calculated).toEqual({
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    });

    expect(result.issues).toEqual([]);
  });

  test("detects an inconsistent printed percentage", () => {
    const result = runAcademicCheck({
      subjects: [
        { subject: "Mathematics", obtained: 85, maximum: 100 },
        { subject: "Physics", obtained: 78, maximum: 100 },
        { subject: "Computer Science", obtained: 82, maximum: 100 },
      ],
      printedTotal: 245,
      printedPercentage: 85,
    });

    expect(result.status).toBe("INCONSISTENT");

    expect(result.issues).toContain(
      "Printed percentage does not match calculated percentage.",
    );
  });

  test("routes invalid academic data to review", () => {
    const result = runAcademicCheck({
      subjects: [
        { subject: "Mathematics", obtained: 110, maximum: 100 },
      ],
      printedTotal: 110,
      printedPercentage: 110,
    });

    expect(result.status).toBe("NEEDS_REVIEW");

    expect(result.issues).toContain(
      "Mathematics: Obtained marks cannot be greater than maximum marks.",
    );
  });

  test("routes missing printed values to review", () => {
    const result = runAcademicCheck({
      subjects: [
        { subject: "Mathematics", obtained: 85, maximum: 100 },
      ],
    });

    expect(result.status).toBe("NEEDS_REVIEW");

    expect(result.calculated).toEqual({
      totalObtained: 85,
      totalMaximum: 100,
      percentage: 85,
    });
  });
});