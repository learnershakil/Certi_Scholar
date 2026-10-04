import type { DocumentTypeDef } from "./types.js";

/**
 * Starting point only. Tune weights against the real sample documents from M0.
 * Admins can change all of this through /document-types without a deployment.
 * extractionProfileId stays null until M4 defines the profiles.
 */
export const DEFAULT_DOCUMENT_TYPES: DocumentTypeDef[] = [
  {
    code: "MARKSHEET",
    name: "Marksheet / Statement of Marks",
    keywords: [
      { term: "marks obtained", weight: 3 },
      { term: "statement of marks", weight: 3 },
      { term: "roll no", weight: 2 },
      { term: "total marks", weight: 2 },
      { term: "percentage", weight: 2 },
      { term: "subject", weight: 1 },
      { term: "board", weight: 1 },
      { term: "result", weight: 1 },
      { term: "grade", weight: 1 },
    ],
    regexPatterns: [],
    anchorTerms: ["statement of marks", "marks obtained", "marksheet", "mark sheet"],
    excludeTerms: ["admit card", "hall ticket", "receipt", "invoice"],
    minConfidence: 0.4,
    extractionProfileId: null,
    active: true,
  },
  {
    code: "ID_AADHAAR",
    name: "Aadhaar Card",
    keywords: [
      { term: "aadhaar", weight: 3 },
      { term: "unique identification authority of india", weight: 3 },
      { term: "uidai", weight: 2 },
      { term: "government of india", weight: 1 },
      { term: "date of birth", weight: 1 },
      { term: "dob", weight: 1 },
      { term: "vid", weight: 1 },
    ],
    regexPatterns: [{ pattern: "\\b\\d{4}\\s\\d{4}\\s\\d{4}\\b", weight: 3 }],
    anchorTerms: ["aadhaar", "uidai", "unique identification authority of india"],
    excludeTerms: [],
    minConfidence: 0.4,
    extractionProfileId: null,
    active: true,
  },
  {
    code: "INCOME_CERT",
    name: "Income Certificate",
    keywords: [
      { term: "income certificate", weight: 4 },
      { term: "annual income", weight: 3 },
      { term: "family income", weight: 2 },
      { term: "tahsildar", weight: 2 },
      { term: "magistrate", weight: 1 },
      { term: "revenue", weight: 1 },
      { term: "certified that", weight: 1 },
      { term: "rupees", weight: 1 },
    ],
    regexPatterns: [],
    anchorTerms: ["income certificate", "tahsildar", "magistrate"],
    excludeTerms: [
      "application form",
      "affidavit",
      "notary",
      "notarized",
      "notarised",
      "salary slip",
      "payslip",
      "pay slip",
    ],
    minConfidence: 0.4,
    extractionProfileId: null,
    active: true,
  },
];
