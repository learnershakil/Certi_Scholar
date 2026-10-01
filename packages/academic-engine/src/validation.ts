import type { SubjectMark } from "./types";

export function validateSubjectMarks(subjects: SubjectMark[]): string[] {
  const errors: string[] = [];

  if (subjects.length === 0) {
    errors.push("No subjects found.");
    return errors;
  }

  for (const subject of subjects) {
    if (subject.obtained < 0) {
      errors.push(`${subject.subject}: Obtained marks cannot be negative.`);
    }

    if (subject.maximum <= 0) {
      errors.push(`${subject.subject}: Maximum marks must be greater than 0.`);
    }

    if (subject.obtained > subject.maximum) {
      errors.push(
        `${subject.subject}: Obtained marks cannot be greater than maximum marks.`,
      );
    }
  }

  return errors;
}