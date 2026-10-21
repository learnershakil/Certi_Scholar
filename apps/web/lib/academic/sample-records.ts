import type { RecordEnvelope } from "./types";

/**
 * Synthetic demonstration records. They are NOT real student records and
 * were NOT extracted from any document. They follow the engine's
 * AcademicRecord contract exactly.
 */
export const SAMPLE_RECORDS: readonly RecordEnvelope[] = [
  {
    id: "demo-consistent",
    label: "Sample 1: Consistent record",
    source: "demo",
    note: "Built so the printed total and percentage agree with the subject marks.",
    record: {
      subjects: [
        { subject: "Engineering Mathematics", obtained: 82, maximum: 100 },
        { subject: "Data Structures", obtained: 76, maximum: 100 },
        { subject: "Digital Electronics", obtained: 69, maximum: 100 },
        { subject: "Physics Lab", obtained: 41, maximum: 50 },
        { subject: "Communication Skills", obtained: 37, maximum: 50 },
      ],
      printedTotal: 305,
      printedPercentage: 76.25,
    },
  },
  {
    id: "demo-printed-percentage-mismatch",
    label: "Sample 2: Incorrect printed percentage",
    source: "demo",
    note: "The printed percentage was deliberately set to a value that does not follow from the marks.",
    record: {
      subjects: [
        { subject: "Mathematics", obtained: 85, maximum: 100 },
        { subject: "Physics", obtained: 78, maximum: 100 },
        { subject: "Computer Science", obtained: 82, maximum: 100 },
      ],
      printedTotal: 245,
      printedPercentage: 85,
    },
  },
  {
    id: "demo-marks-exceed-maximum",
    label: "Sample 3: Marks exceed maximum",
    source: "demo",
    note: "One subject has obtained marks above its maximum.",
    record: {
      subjects: [
        { subject: "Mathematics", obtained: 110, maximum: 100 },
        { subject: "Physics", obtained: 74, maximum: 100 },
        { subject: "Chemistry", obtained: 81, maximum: 100 },
      ],
      printedTotal: 265,
      printedPercentage: 88.33,
    },
  },
  {
    id: "demo-printed-values-missing",
    label: "Sample 4: Printed values not supplied",
    source: "demo",
    note: "No printed total or printed percentage is included in this record.",
    record: {
      subjects: [
        { subject: "Mathematics", obtained: 91, maximum: 100 },
        { subject: "Physics", obtained: 84, maximum: 100 },
        { subject: "Chemistry", obtained: 77, maximum: 100 },
        { subject: "English", obtained: 88, maximum: 100 },
      ],
    },
  },
];

export function findSampleById(id: string): RecordEnvelope | undefined {
  return SAMPLE_RECORDS.find((sample) => sample.id === id);
}