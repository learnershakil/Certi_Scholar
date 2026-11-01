import { describe, expect, it } from 'vitest';
import { checkIdentity, checkIncomeCertificate, checkMarksheet, marksFromWords, runConsistencyChecks, verhoeffValid } from '../src/domain/consistency.js';
import { deriveFacts, type DocumentFacts } from '../src/domain/facts.js';

const marks = (overrides: Record<string, string | null> = {}) => ({
  'subjects.0.name': 'English',
  'subjects.0.max': '100',
  'subjects.0.obtained': '88',
  'subjects.1.name': 'Mathematics',
  'subjects.1.max': '100',
  'subjects.1.obtained': '92',
  total_obtained: '180',
  total_max: '200',
  percentage: '90.00',
  ...overrides,
});
const byCode = (checks: ReturnType<typeof checkMarksheet>) => Object.fromEntries(checks.map((c) => [c.code, c]));

describe('marksheet recomputation (M6)', () => {
  it('passes a consistent marksheet', () => {
    expect(checkMarksheet(marks(), 0.05).every((c) => c.status === 'pass')).toBe(true);
  });

  it('detects a printed percentage that disagrees with subject marks', () => {
    const c = byCode(checkMarksheet(marks({ percentage: '94.00' }), 0.05)).percentage_matches_marks;
    expect(c).toMatchObject({ status: 'fail', expected: 90, actual: 94 });
    expect(c.message).toMatch(/Recomputed 90% \(180\/200\) disagrees with printed 94%/);
  });

  it('respects the configured tolerance for rounding', () => {
    expect(byCode(checkMarksheet(marks({ percentage: '90.04' }), 0.05)).percentage_matches_marks.status).toBe('pass');
    expect(byCode(checkMarksheet(marks({ percentage: '90.04' }), 0)).percentage_matches_marks.status).toBe('fail');
  });

  it('detects a printed total that disagrees with the sum', () => {
    expect(byCode(checkMarksheet(marks({ total_obtained: '181' }), 0.05)).total_matches_marks).toMatchObject({ status: 'fail', expected: 180, actual: 181 });
  });

  it('detects marks above the subject maximum', () => {
    expect(byCode(checkMarksheet(marks({ 'subjects.1.obtained': '120', total_obtained: '208', percentage: '104' }), 0.05)).subject_marks_within_max.status).toBe('fail');
  });

  it('is not applicable when subject marks are unreadable', () => {
    expect(checkMarksheet(marks({ 'subjects.0.obtained': null }), 0.05).every((c) => c.status === 'not_applicable')).toBe(true);
  });
});

describe('income and identity checks', () => {
  const now = new Date('2026-11-04');
  it('flags stale and future certificates', () => {
    const at = (d: string) => checkIncomeCertificate({ annual_income: '2,40,000', issue_date: d }, now)[1].status;
    expect(at('15/06/2026')).toBe('pass');
    expect(at('15/06/2024')).toBe('fail');
    expect(at('15/06/2027')).toBe('fail');
  });

  it('flags a non-numeric income', () => {
    expect(checkIncomeCertificate({ annual_income: 'two lakh' }, now)[0].status).toBe('fail');
  });

  it('validates the ID checksum (Verhoeff)', () => {
    expect(verhoeffValid('234567890124')).toBe(true);
    expect(verhoeffValid('234567890125')).toBe(false);
    expect(checkIdentity({ id_number: '2345 6789 0125', date_of_birth: '14/08/2007' }, now)[0].status).toBe('fail');
    expect(checkIdentity({ id_number: '2345 6789 0124', date_of_birth: '14/08/2007' }, now).every((c) => c.status === 'pass')).toBe(true);
  });

  it('returns no checks for an unknown type', () => {
    expect(runConsistencyChecks(null, {}, 0.05)).toEqual([]);
  });
});

describe('fact derivation', () => {
  const doc = (over: Partial<DocumentFacts>): DocumentFacts => ({
    documentId: 'd1',
    documentType: 'marksheet',
    fields: {},
    consistencyChecks: [],
    verificationStatus: 'not_verified',
    ...over,
  });

  it('uses the recomputed percentage and notes a disagreeing printed value', () => {
    const { facts, provenance } = deriveFacts({}, [
      doc({ fields: { percentage: { value: '94.00', status: 'auto_accepted' } }, consistencyChecks: [{ code: 'percentage_matches_marks', status: 'fail', expected: 90 }] }),
    ]);
    expect(facts['marksheet.percentage']).toBe(90);
    expect(facts['marksheet.consistent']).toBe(false);
    expect(provenance['marksheet.percentage'].note).toMatch(/Printed value 94 disagrees/);
  });

  it('withholds fields that are still awaiting review', () => {
    const { facts } = deriveFacts({}, [doc({ documentType: 'income_certificate', fields: { annual_income: { value: '2,40,000', status: 'needs_review' } } })]);
    expect(facts['income.annualIncome']).toBeUndefined();
    expect(facts['documents.reviewComplete']).toBe(false);
  });

  it('never counts a simulated check as established authenticity', () => {
    expect(deriveFacts({}, [doc({ verificationStatus: 'simulated_match' })]).facts['documents.authenticityEstablished']).toBe(false);
    expect(deriveFacts({}, [doc({ verificationStatus: 'authority_match' })]).facts['documents.authenticityEstablished']).toBe(true);
    expect(deriveFacts({}, [doc({ verificationStatus: 'manual_match' })]).facts['documents.authenticityEstablished']).toBe(true);
  });

  it('labels self-declared profile facts', () => {
    const { facts, provenance } = deriveFacts({ category: 'SC', gender: 'female' }, []);
    expect(facts['applicant.category']).toBe('SC');
    expect(provenance['applicant.gender'].source).toMatch(/self-declared/);
    expect(facts['documents.reviewComplete']).toBeUndefined();
  });
});

describe('ICSE marksheets (no printed total, marks in words)', () => {
  const icse = (over: Record<string, string | null> = {}) => ({
    'subjects.0.name': 'ENGLISH', 'subjects.0.obtained': '88', 'subjects.0.words': 'EIGHT EIGHT', 'subjects.0.max': '100',
    'subjects.1.name': 'SCIENCE', 'subjects.1.obtained': '87', 'subjects.1.words': 'EIGHT SEVEN', 'subjects.1.max': '100',
    ...over,
  });

  it('converts marks written in words', () => {
    expect(marksFromWords('EIGHT EIGHT')).toBe(88);
    expect(marksFromWords('one zero zero')).toBe(100);
    expect(marksFromWords('HUNDRED')).toBe(100);
    expect(marksFromWords('EIGHTY')).toBeNull();
  });

  it('recomputes the aggregate when none is printed and checks words against figures', () => {
    const c = Object.fromEntries(checkMarksheet(icse(), 0.05).map((x) => [x.code, x]));
    expect(c.percentage_matches_marks).toMatchObject({ status: 'not_applicable', expected: 87.5 });
    expect(c.total_matches_marks.status).toBe('not_applicable');
    expect(c.marks_words_match_figures.status).toBe('pass');
  });

  it('flags marks whose words disagree with the figures', () => {
    const c = checkMarksheet(icse({ 'subjects.1.obtained': '81' }), 0.05).find((x) => x.code === 'marks_words_match_figures');
    expect(c).toMatchObject({ status: 'fail', message: expect.stringMatching(/SCIENCE \(81 vs "EIGHT SEVEN"\)/) });
  });

  it('waits for an unreadable row to be reviewed before recomputing', () => {
    expect(checkMarksheet(icse({ 'subjects.1.obtained': null }), 0.05).every((x) => x.status === 'not_applicable')).toBe(true);
  });

  it('accepts dotted dates', () => {
    expect(checkIdentity({ id_number: '2345 6789 0124', date_of_birth: '14.08.2007' }, new Date('2026-11-04'))[1].status).toBe('pass');
  });
});
