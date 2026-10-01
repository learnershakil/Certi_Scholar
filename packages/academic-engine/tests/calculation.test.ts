import { describe, expect, test } from "bun:test";
import { calculateAcademicResult } from "../src/calculation";

describe("calculateAcademicResult", () => {
  test("calculates total and percentage correctly", () => {
    const subjects = [
      {
        subject: "Maths",
        obtained: 85,
        maximum: 100,
      },
      {
        subject: "Physics",
        obtained: 78,
        maximum: 100,
      },
      {
        subject: "Chemistry",
        obtained: 82,
        maximum: 100,
      },
    ];

    const result = calculateAcademicResult(subjects);

    expect(result.totalObtained).toBe(245);
    expect(result.totalMaximum).toBe(300);
    expect(result.percentage).toBe(81.67);
  });
});