import { describe, expect, test } from "bun:test";
import { checkConsistency } from "../src/consistency";

describe("checkConsistency", () => {
  test("returns CONSISTENT when printed values match calculated values", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 245,
      percentage: 81.67,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("CONSISTENT");
    expect(result.issues).toHaveLength(0);
  });

  test("returns INCONSISTENT when printed total does not match calculated total", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 250,
      percentage: 81.67,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("INCONSISTENT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].field).toBe("total");
  });

  test("returns INCONSISTENT when printed percentage does not match calculated percentage", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 245,
      percentage: 85,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("INCONSISTENT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].field).toBe("percentage");
  });

  test("returns INCONSISTENT when both printed values are incorrect", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 250,
      percentage: 85,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("INCONSISTENT");
    expect(result.issues).toHaveLength(2);
  });

  test("returns NEEDS_REVIEW when both printed values are missing", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {};

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.issues).toHaveLength(0);
  });

  test("returns NEEDS_REVIEW when printed total is missing", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      percentage: 81.67,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.issues).toHaveLength(0);
  });

  test("returns NEEDS_REVIEW when printed percentage is missing", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 245,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.issues).toHaveLength(0);
  });

  test("allows a small difference within the tolerance", () => {
    const calculated = {
      totalObtained: 245,
      totalMaximum: 300,
      percentage: 81.67,
    };

    const printed = {
      total: 245,
      percentage: 81.675,
    };

    const result = checkConsistency(calculated, printed);

    expect(result.status).toBe("CONSISTENT");
    expect(result.issues).toHaveLength(0);
  });
});