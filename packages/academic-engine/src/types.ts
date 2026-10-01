export interface SubjectMark {
  subject: string;
  obtained: number;
  maximum: number;
}

export interface AcademicRecord {
  subjects: SubjectMark[];
  printedTotal?: number;
  printedPercentage?: number;
}