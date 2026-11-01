import { describe, expect, it } from 'vitest';
import { classify, extractFields, fullText, isValidKind, pickBestProfile, type Profile } from '../src/domain/extraction.js';
import { DOCUMENT_TYPES, EXTRACTION_PROFILES } from '../src/seedData.js';
import { fakeOcr, IDENTITY, INCOME, MARKSHEET } from './helpers.js';

const profile = (type: string) => EXTRACTION_PROFILES.find((p) => p.documentType === type) as unknown as Profile;
const byKey = (fields: ReturnType<typeof extractFields>) => Object.fromEntries(fields.map((f) => [f.key, f]));

describe('classification (M3)', () => {
  it.each([
    [MARKSHEET, 'marksheet'],
    [INCOME, 'income_certificate'],
    [IDENTITY, 'identity'],
  ])('routes sample %# to its profile', (lines, expected) => {
    expect(classify(lines.join('\n'), DOCUMENT_TYPES, 0.6).documentType).toBe(expected);
  });

  it('returns no type when coverage is below threshold', () => {
    const r = classify('a letter about something unrelated', DOCUMENT_TYPES, 0.6);
    expect(r.documentType).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('refuses to pick between near-tied types', () => {
    const types = [
      { code: 'a', keywords: [{ term: 'alpha', weight: 1 }] },
      { code: 'b', keywords: [{ term: 'alpha', weight: 1 }] },
    ];
    expect(classify('alpha', types, 0.5).documentType).toBeNull();
  });
});

describe('field extraction with confidence (M4)', () => {
  it('extracts every marksheet field and subject row with source regions', () => {
    const fields = byKey(extractFields(fakeOcr(MARKSHEET), profile('marksheet'), 0.85));
    expect(fields.student_name.value).toBe('ANANYA SHARMA');
    expect(fields.roll_number.value).toBe('2410387');
    expect(fields.board.value).toBe('STATE BOARD OF HIGHER SECONDARY EDUCATION');
    expect(fields.total_obtained.value).toBe('441');
    expect(fields.total_max.value).toBe('500');
    expect(fields.percentage.value).toBe('88.20');
    expect(fields['subjects.4.name'].value).toBe('Computer Science');
    expect(fields['subjects.4.obtained'].value).toBe('95');
    expect(Object.keys(fields).filter((k) => k.startsWith('subjects.')).length).toBe(15);
    for (const f of Object.values(fields)) {
      expect(f.status).toBe('auto_accepted');
      expect(f.bbox).toHaveLength(4);
    }
  });

  it('bounding box covers exactly the value words, not the label', () => {
    const fields = byKey(extractFields(fakeOcr(MARKSHEET), profile('marksheet'), 0.85));
    const [x0] = fields.student_name.bbox!;
    // "Name of Candidate:" ends at x=0.262 in the fake layout; the value box must start after it.
    expect(x0).toBeCloseTo(0.272, 3);
  });

  it('routes low-confidence fields to review instead of accepting them', () => {
    const ocr = fakeOcr(MARKSHEET, (w) => (w === '88.20' ? 0.6 : 0.97));
    const f = byKey(extractFields(ocr, profile('marksheet'), 0.85)).percentage;
    expect(f.value).toBe('88.20');
    expect(f.status).toBe('needs_review');
    expect(f.confidence).toMatchObject({ ocr: 0.6, overall: 0.6, threshold: 0.9 });
  });

  it('applies the per-field threshold over the global default', () => {
    const ocr = fakeOcr(MARKSHEET, (w) => (w === '88.20' ? 0.88 : 0.97));
    expect(byKey(extractFields(ocr, profile('marksheet'), 0.85)).percentage.status).toBe('needs_review'); // field threshold 0.9
  });

  it('never invents a missing required value', () => {
    const f = byKey(extractFields(fakeOcr(MARKSHEET.filter((l) => !l.startsWith('Roll'))), profile('marksheet'), 0.85)).roll_number;
    expect(f).toMatchObject({ value: null, status: 'needs_review', confidence: { overall: 0 } });
  });

  it('omits a missing optional field', () => {
    const fields = byKey(extractFields(fakeOcr(MARKSHEET.slice(1)), profile('marksheet'), 0.85));
    expect(fields.board).toBeUndefined();
  });

  it('zeroes confidence when the value fails its type check', () => {
    const lines = INCOME.map((l) => (l.startsWith('Date of Issue') ? 'Date of Issue: 31/02/2026' : l));
    const f = byKey(extractFields(fakeOcr(lines), profile('income_certificate'), 0.85)).issue_date;
    expect(f).toMatchObject({ value: '31/02/2026', status: 'needs_review', confidence: { pattern: 0, overall: 0 } });
  });

  it('extracts income and identity profiles', () => {
    const income = byKey(extractFields(fakeOcr(INCOME), profile('income_certificate'), 0.85));
    expect(income.annual_income.value).toBe('2,40,000');
    expect(income.certificate_number.value).toBe('INC/2026/004512');
    const id = byKey(extractFields(fakeOcr(IDENTITY), profile('identity'), 0.85));
    expect(id.id_number.value).toBe('2345 6789 0124');
    expect(id.date_of_birth.value).toBe('14/08/2007');
  });

  it('joins text across pages', () => {
    expect(fullText(fakeOcr(['a', 'b']))).toBe('a\nb');
  });
});

describe('type checks', () => {
  it.each([
    ['number', '2,40,000', true],
    ['number', 'Rs. 1,000', true],
    ['number', '88.20', true],
    ['number', 'eighty', false],
    ['date', '29/02/2024', true],
    ['date', '29/02/2025', false],
    ['id', 'INC/2026/1', true],
    ['text', '1234', false],
  ])('%s %s → %s', (kind, value, ok) => expect(isValidKind(kind, value)).toBe(ok));
});

describe('ICSE Class X format (real layout, fictional candidate)', () => {
  // Lines and confidences mirror what Tesseract returned for a phone photo of an ICSE statement of marks.
  const ICSE = [
    'COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS, NEW DELHI',
    'INDIAN CERTIFICATE OF SECONDARY EDUCATION (CLASS - X) - YEAR 2022',
    'No. TU 10012345',
    'STATEMENT OF MARKS',
    'Name RIYA SEN a',
    "of ST. MARY'S SCHOOL, PUNE r",
    'Unique ID 7654321 |',
    'SUBJECTS PERCENTAGE MARKS',
    'ENGLISH 88 EIGHT EIGHT',
    'ENGLISH LANGUAGE',
    'FEE Ee VE JPG)',
    'HISTORY, CIVICS & GEOGRAPHY 92 NINE TWO',
    'HISTORY & CIVICS 098',
    'SCIENCE 87 EIGHT SEVEN',
    'PHYSICS 083',
    'COMPUTER APPLICATIONS 099 99 NINE NINE',
    'Internal Assessment GRADE',
    'atthe time of (in figures) 21.02.2006 :',
    'RESULT- PASS CERTIFICATE AWARDED',
  ];
  const conf = (w: string) => (['FEE', 'Ee', 'VE', 'JPG)'].includes(w) ? 0.15 : ['a', 'r', '|'].includes(w) ? 0.5 : w === '7654321' ? 0.41 : 0.95);
  const ocr = fakeOcr(ICSE, conf);
  const profiles = EXTRACTION_PROFILES.filter((p) => p.documentType === 'marksheet') as unknown as Array<Profile & { format: string }>;
  const icseFields = () => byKey(pickBestProfile(ocr, profiles, 0.85)!.values);

  it('classifies it as a marksheet through board synonyms', () => {
    expect(classify(fullText(ocr), DOCUMENT_TYPES, 0.6)).toMatchObject({ documentType: 'marksheet', confidence: 1 });
  });

  it('picks the ICSE format for ICSE, and the standard format for the standard sample', () => {
    expect(pickBestProfile(ocr, profiles, 0.85)!.profile.format).toBe('icse-class-x');
    expect(pickBestProfile(fakeOcr(MARKSHEET), profiles, 0.85)!.profile.format).toBe('standard');
  });

  it('reads the candidate fields and keeps OCR noise out of the name', () => {
    const f = icseFields();
    expect(f.student_name).toMatchObject({ value: 'RIYA SEN', status: 'auto_accepted' });
    expect(f.school.value).toBe("ST. MARY'S SCHOOL, PUNE");
    expect(f.exam_year.value).toBe('2022');
    expect(f.certificate_number.value).toBe('TU 10012345');
    expect(f.result.value).toBe('PASS');
    expect(f.date_of_birth).toMatchObject({ value: '21.02.2006', confidence: { pattern: 1 } });
    expect(f.roll_number).toMatchObject({ value: '7654321', status: 'needs_review' }); // read at 41% confidence
  });

  it('reads subject rows, skips paper-level lines and applies the format maximum', () => {
    const f = icseFields();
    expect(f['subjects.0.name'].value).toBe('ENGLISH');
    expect(f['subjects.0.obtained'].value).toBe('88');
    expect(f['subjects.0.words'].value).toBe('EIGHT EIGHT');
    expect(f['subjects.0.max']).toMatchObject({ value: '100', status: 'auto_accepted' });
    expect(f['subjects.2.name'].value).toBe('HISTORY, CIVICS & GEOGRAPHY');
    expect(f['subjects.4.obtained'].value).toBe('99'); // the 099 paper mark before it is not the subject mark
    expect(f['subjects.5.name']).toBeUndefined();
  });

  it('turns an unreadable line inside the table into an empty row for the officer', () => {
    const f = icseFields();
    expect(f['subjects.1.name']).toMatchObject({ value: null, status: 'needs_review' });
    expect(f['subjects.1.obtained']).toMatchObject({ value: null, status: 'needs_review' });
    expect(f['subjects.1.name'].label).toMatch(/line unreadable/);
    expect(f['subjects.1.name'].bbox).toHaveLength(4); // points the officer at the line on the image
  });
});
