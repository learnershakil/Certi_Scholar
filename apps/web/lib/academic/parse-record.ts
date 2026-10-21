import type { AcademicRecord, SubjectMark } from "@repo/academic-engine";

/**
 * Request-shape validation ONLY.
 *
 * This file answers: "is this JSON the shape of an AcademicRecord?"
 * It does NOT decide whether the marks are academically valid
 * (negative marks, maximum <= 0, obtained > maximum). Those rules
 * belong to the academic engine and must not be duplicated here.
 */

/** Guard against oversized requests. Not an academic rule. */
export const MAX_SUBJECTS = 100;

export type ParseRecordResult =
  | { ok: true; record: AcademicRecord }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseAcademicRecord(body: unknown): ParseRecordResult {
  if (!isPlainObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const errors: string[] = [];
  const rawSubjects = body["subjects"];

  if (!Array.isArray(rawSubjects)) {
    return { ok: false, errors: ["subjects must be an array."] };
  }

  if (rawSubjects.length > MAX_SUBJECTS) {
    return {
      ok: false,
      errors: [`subjects must not contain more than ${MAX_SUBJECTS} entries.`],
    };
  }

  const subjects: SubjectMark[] = [];

  rawSubjects.forEach((entry: unknown, index: number) => {
    const path = `subjects[${index}]`;

    if (!isPlainObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }

    const subject = entry["subject"];
    const obtained = entry["obtained"];
    const maximum = entry["maximum"];

    if (typeof subject !== "string") {
      errors.push(`${path}.subject must be a string.`);
    }
    if (!isFiniteNumber(obtained)) {
      errors.push(`${path}.obtained must be a finite number.`);
    }
    if (!isFiniteNumber(maximum)) {
      errors.push(`${path}.maximum must be a finite number.`);
    }

    if (
      typeof subject === "string" &&
      isFiniteNumber(obtained) &&
      isFiniteNumber(maximum)
    ) {
      subjects.push({ subject, obtained, maximum });
    }
  });

  const printedTotal = body["printedTotal"];
  const printedPercentage = body["printedPercentage"];

  if (printedTotal !== undefined && !isFiniteNumber(printedTotal)) {
    errors.push("printedTotal must be a finite number when supplied.");
  }
  if (printedPercentage !== undefined && !isFiniteNumber(printedPercentage)) {
    errors.push("printedPercentage must be a finite number when supplied.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build a clean object so unknown extra fields never reach the engine.
  const record: AcademicRecord = { subjects };
  if (isFiniteNumber(printedTotal)) {
    record.printedTotal = printedTotal;
  }
  if (isFiniteNumber(printedPercentage)) {
    record.printedPercentage = printedPercentage;
  }

  return { ok: true, record };
}