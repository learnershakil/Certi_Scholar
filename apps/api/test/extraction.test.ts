import { describe, expect, it } from 'vitest';
import { classify, extractFields, fullText, isValidKind, type Profile } from '../src/domain/extraction.js';
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
