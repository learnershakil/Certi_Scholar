import { DocumentTypeModel, ExtractionProfileModel } from './models/document.js';
import { ScholarshipModel, ScholarshipRuleModel } from './models/scholarship.js';
import { SettingsModel } from './models/system.js';
import { UserModel, type Role } from './models/user.js';
import { hashPassword } from './lib/crypto.js';
import type { RuleNode } from './domain/rules.js';

export const DOCUMENT_TYPES = [
  {
    code: 'marksheet',
    name: 'Statement of Marks',
    // `|` separates synonyms used by different boards (state boards, CBSE, ICSE, universities).
    keywords: [
      { term: 'statement of marks|marksheet|mark sheet|grade sheet', weight: 3 },
      { term: 'marks obtained|percentage marks|total marks|grand total', weight: 2 },
      { term: 'roll number|roll no|unique id|index no', weight: 2 },
      { term: 'percentage', weight: 1 },
      { term: 'subject', weight: 1 },
      { term: 'board|council|university', weight: 1 },
      { term: 'examination', weight: 1 },
    ],
  },
  {
    code: 'income_certificate',
    name: 'Income Certificate',
    keywords: [
      { term: 'income certificate', weight: 3 },
      { term: 'annual family income', weight: 2 },
      { term: 'tahsildar', weight: 1 },
      { term: 'certificate no', weight: 1 },
      { term: 'issuing authority', weight: 1 },
    ],
  },
  {
    code: 'identity',
    name: 'Identity Document',
    keywords: [
      { term: 'identity card', weight: 3 },
      { term: 'date of birth', weight: 2 },
      { term: 'id number', weight: 2 },
      { term: 'gender', weight: 1 },
    ],
  },
];

const NAME = String.raw`([A-Z][A-Za-z .']+?)\s*$`;
const DATE = String.raw`(\d{2}[/-]\d{2}[/-]\d{4})`;

export const EXTRACTION_PROFILES = [
  {
    documentType: 'marksheet',
    format: 'standard',
    name: 'State board statement of marks (printed total and percentage)',
    version: 1,
    fields: [
      { key: 'student_name', label: 'Candidate name', kind: 'text', pattern: String.raw`Name of (?:the )?Candidate\s*:?\s*` + NAME, required: true },
      { key: 'roll_number', label: 'Roll number', kind: 'id', pattern: String.raw`Roll\s*(?:No\.?|Number)\s*:?\s*([A-Z0-9]+)`, required: true },
      { key: 'board', label: 'Examining board', kind: 'text', pattern: String.raw`^((?:[A-Z]+ )*BOARD(?: [A-Z]+)*)$`, required: false },
      { key: 'exam_year', label: 'Year of examination', kind: 'number', pattern: String.raw`Year of Examination\s*:?\s*(\d{4})`, required: true },
      { key: 'total_obtained', label: 'Total marks obtained', kind: 'number', pattern: String.raw`Total Marks Obtained\s*:?\s*(\d+)`, required: true },
      { key: 'total_max', label: 'Maximum total', kind: 'number', pattern: String.raw`Total Marks Obtained\s*:?\s*\d+\s*/\s*(\d+)`, required: true },
      { key: 'percentage', label: 'Percentage (printed)', kind: 'number', pattern: String.raw`Percentage\s*:?\s*(\d{1,3}(?:\.\d+)?)`, required: true, threshold: 0.9 },
    ],
    table: {
      key: 'subjects',
      label: 'Subject',
      rowPattern: String.raw`^([A-Za-z][A-Za-z .&]+?)\s+(\d{2,3})\s+(\d{1,3})$`,
      columns: [
        { key: 'name', kind: 'text' },
        { key: 'max', kind: 'number' },
        { key: 'obtained', kind: 'number' },
      ],
    },
  },
  {
    documentType: 'marksheet',
    format: 'icse-class-x',
    name: 'ICSE Class X statement of marks (CISCE)',
    version: 1,
    // ICSE prints no grand total or aggregate: each subject's percentage mark is printed in figures and in words,
    // and every subject is out of 100. The aggregate is therefore always recomputed.
    fields: [
      { key: 'student_name', label: 'Candidate name', kind: 'text', pattern: String.raw`^Name\s*:?\s*([A-Za-z.']{2,}(?:\s+[A-Za-z.']{2,})*)`, required: true },
      { key: 'roll_number', label: 'Unique ID', kind: 'id', pattern: String.raw`Unique\s*ID\s*:?\s*(\d{5,})`, required: true },
      { key: 'exam_year', label: 'Year of examination', kind: 'number', pattern: String.raw`\bYEAR\s*:?\s*(\d{4})`, required: true },
      { key: 'board', label: 'Examining board', kind: 'text', pattern: String.raw`^(COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS)`, required: false },
      { key: 'certificate_number', label: 'Certificate number', kind: 'id', pattern: String.raw`^No\.?\s*([A-Z]{1,3}\s?\d{6,})`, required: false },
      { key: 'school', label: 'School', kind: 'text', pattern: String.raw`^of\s+([A-Za-z.',&]{2,}(?:\s+[A-Za-z.',&]{2,})*)`, required: false },
      { key: 'result', label: 'Result', kind: 'text', pattern: String.raw`RESULT\W*(PASS|FAIL)`, required: false },
      { key: 'date_of_birth', label: 'Date of birth', kind: 'date', pattern: String.raw`\(in figures\)\s*(\d{2}[./-]\d{2}[./-]\d{4})`, required: false },
    ],
    table: {
      key: 'subjects',
      label: 'Subject',
      // "ENGLISH 88 EIGHT EIGHT", "COMPUTER APPLICATIONS 099 99 NINE NINE": the subject's percentage mark is the
      // number followed by the same number in words. Paper-level lines ("PHYSICS 083") carry no words and are skipped.
      rowPattern: String.raw`^([A-Za-z][A-Za-z ,.&]+?)\s+(?:\d{3}\s+)?(\d{1,3})\s+((?:ZERO|NIL|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|HUNDRED)(?:\s+(?:ZERO|NIL|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))*)$`,
      columns: [
        { key: 'name', kind: 'text' },
        { key: 'obtained', kind: 'number' },
        { key: 'words', kind: 'text' },
        { key: 'max', kind: 'number', fixed: '100' },
      ],
    },
  },
  {
    documentType: 'income_certificate',
    format: 'standard',
    name: 'Tahsildar income certificate',
    version: 1,
    fields: [
      { key: 'certificate_number', label: 'Certificate number', kind: 'id', pattern: String.raw`Certificate\s*No\.?\s*:?\s*([A-Z0-9/-]+)`, required: true },
      { key: 'holder_name', label: 'Name', kind: 'text', pattern: String.raw`^Name\s*:?\s*` + NAME, required: true },
      { key: 'annual_income', label: 'Annual family income', kind: 'number', pattern: String.raw`Annual (?:Family )?Income\s*:?\s*(?:Rs\.?|₹)?\s*([\d,]+)`, required: true, threshold: 0.9 },
      { key: 'issue_date', label: 'Date of issue', kind: 'date', pattern: String.raw`Date of Issue\s*:?\s*` + DATE, required: true },
      { key: 'issuing_authority', label: 'Issuing authority', kind: 'text', pattern: String.raw`Issuing Authority\s*:?\s*(.+)$`, required: false },
    ],
  },
  {
    documentType: 'identity',
    format: 'standard',
    name: 'Resident identity card',
    version: 1,
    fields: [
      { key: 'full_name', label: 'Full name', kind: 'text', pattern: String.raw`^Name\s*:?\s*` + NAME, required: true },
      { key: 'date_of_birth', label: 'Date of birth', kind: 'date', pattern: String.raw`(?:Date of Birth|DOB)\s*:?\s*` + DATE, required: true },
      { key: 'id_number', label: 'ID number', kind: 'id', pattern: String.raw`ID\s*(?:Number|No\.?)\s*:?\s*(\d{4}\s?\d{4}\s?\d{4})`, required: true },
    ],
  },
];

export const RULES: Record<string, RuleNode> = {
  'MCM-2026': {
    type: 'group',
    op: 'AND',
    label: 'Merit-cum-Means eligibility',
    children: [
      { type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 60 },
      { type: 'condition', fact: 'marksheet.consistent', operator: 'is_true' },
      { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 250000 },
      { type: 'condition', fact: 'documents.reviewComplete', operator: 'is_true' },
      { type: 'condition', fact: 'documents.authenticityEstablished', operator: 'is_true' },
    ],
  },
  'GSTEM-2026': {
    type: 'group',
    op: 'AND',
    label: 'Women in STEM eligibility',
    children: [
      { type: 'condition', fact: 'applicant.gender', operator: 'eq', value: 'female' },
      { type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 75 },
      { type: 'condition', fact: 'identity.provided', operator: 'is_true' },
      {
        type: 'group',
        op: 'OR',
        label: 'Means test or category',
        children: [
          { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 800000 },
          { type: 'condition', fact: 'applicant.category', operator: 'in', value: ['SC', 'ST'] },
        ],
      },
    ],
  },
};

export const SCHOLARSHIPS = [
  {
    code: 'MCM-2026',
    name: 'Merit-cum-Means Scholarship 2026',
    sponsor: 'Office of Student Services',
    amount: 50000,
    description: 'For students with at least 60% aggregate and family income up to ₹2.5 lakh per year.',
    requiredDocuments: ['marksheet', 'income_certificate'],
  },
  {
    code: 'GSTEM-2026',
    name: 'Women in STEM Scholarship 2026',
    sponsor: 'Alumni Endowment Fund',
    amount: 75000,
    description: 'For women students with at least 75% aggregate entering science and engineering programmes.',
    requiredDocuments: ['marksheet', 'income_certificate', 'identity'],
  },
];

export const DEMO_PASSWORD = 'Demo#Pass2026';

export async function seedReferenceData(opts: { verificationProvider?: string } = {}) {
  for (const t of DOCUMENT_TYPES) await DocumentTypeModel.updateOne({ code: t.code }, t, { upsert: true });
  // Profiles created before formats existed are the 'standard' format; then rebuild indexes for (type, format, version).
  await ExtractionProfileModel.updateMany({ format: { $exists: false } }, { $set: { format: 'standard' } });
  await ExtractionProfileModel.syncIndexes();
  for (const p of EXTRACTION_PROFILES) {
    if (!(await ExtractionProfileModel.exists({ documentType: p.documentType, format: p.format }))) await ExtractionProfileModel.create(p);
  }
  await SettingsModel.updateOne({ _id: 'global' }, { $setOnInsert: { verificationProvider: opts.verificationProvider ?? 'manual_only' } }, { upsert: true });
}

export async function seedDemo() {
  await seedReferenceData({ verificationProvider: 'simulated' });
  const users: Array<{ email: string; name: string; role: Role; profile?: Record<string, string> }> = [
    { email: 'admin@certischolar.local', name: 'Priya Raman', role: 'admin' },
    { email: 'verifier@certischolar.local', name: 'Rahul Mehta', role: 'verifier' },
    { email: 'officer@certischolar.local', name: 'Sunita Iyer', role: 'scholarship_officer' },
    { email: 'student@certischolar.local', name: 'Ananya Sharma', role: 'student', profile: { category: 'OBC', gender: 'female', state: 'Karnataka' } },
    { email: 'student2@certischolar.local', name: 'Arjun Verma', role: 'student', profile: { category: 'GEN', gender: 'male', state: 'Maharashtra' } },
  ];
  for (const u of users) {
    if (!(await UserModel.exists({ email: u.email }))) await UserModel.create({ ...u, passwordHash: hashPassword(DEMO_PASSWORD) });
  }
  const officer = await UserModel.findOne({ role: 'scholarship_officer' });
  for (const s of SCHOLARSHIPS) {
    const sch = await ScholarshipModel.findOneAndUpdate({ code: s.code }, { ...s, officers: [officer!._id] }, { upsert: true, returnDocument: 'after' });
    if (!(await ScholarshipRuleModel.exists({ scholarship: sch._id }))) {
      await ScholarshipRuleModel.create({ scholarship: sch._id, version: 1, root: RULES[s.code], changeNote: 'Initial rule set' });
    }
  }
}
