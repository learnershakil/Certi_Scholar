import { describe, expect, test } from "bun:test";
import { validateSubjectMarks } from "../src/validation";

describe("validateSubjectMarks", () => {
  test("accepts valid subject marks", () => {
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
    ];

    const errors = validateSubjectMarks(subjects);

    expect(errors).toHaveLength(0);
  });

  test("rejects negative marks", () => {
    const subjects = [
      {
        subject: "Maths",
        obtained: -5,
        maximum: 100,
      },
    ];

    const errors = validateSubjectMarks(subjects);

    expect(errors).toContain(
      "Maths: Obtained marks cannot be negative.",
    );
  });

  test("rejects marks greater than maximum", () => {
    const subjects = [
      {
        subject: "Maths",
        obtained: 110,
        maximum: 100,
      },
    ];

    const errors = validateSubjectMarks(subjects);

    expect(errors).toContain(
      "Maths: Obtained marks cannot be greater than maximum marks.",
    );
  });

  test("rejects invalid maximum marks", () => {
    const subjects = [
      {
        subject: "Maths",
        obtained: 50,
        maximum: 0,
      },
    ];

    const errors = validateSubjectMarks(subjects);

    expect(errors).toContain(
      "Maths: Maximum marks must be greater than 0.",
    );
  });

  test("rejects an empty subject list", () => {
    const errors = validateSubjectMarks([]);

    expect(errors).toContain("No subjects found.");
  });
});