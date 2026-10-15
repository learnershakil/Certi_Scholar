/**
 * M6 — academic recomputation and internal consistency. These checks establish that a document
 * agrees with itself; they say nothing about whether it is genuine.
 */

export interface CheckResult {
  code: string;
  label: string;
  status: 'pass' | 'fail' | 'not_applicable';
  expected?: unknown;
  actual?: unknown;
  message: string;
}

export type FieldValues = Record<string, string | null | undefined>;

export const toNumber = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v.replace(/[,₹\s]|Rs\.?/gi, '').replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function subjectRows(fields: FieldValues) {
  const rows: Array<{ name: string; max: number | null; obtained: number | null }> = [];
  for (let i = 0; fields[`subjects.${i}.name`] !== undefined; i++) {
    rows.push({ name: fields[`subjects.${i}.name`] ?? `Subject ${i + 1}`, max: toNumber(fields[`subjects.${i}.max`]), obtained: toNumber(fields[`subjects.${i}.obtained`]) });
  }
  return rows;
}

export function checkMarksheet(fields: FieldValues, tolerance: number): CheckResult[] {
  const rows = subjectRows(fields);
  const na = (code: string, label: string, message: string): CheckResult => ({ code, label, status: 'not_applicable', message });
  if (!rows.length || rows.some((r) => r.max === null || r.obtained === null)) {
    const msg = 'Subject marks are missing or unreadable; recomputation is not possible until they are reviewed';
    return [
      na('subject_marks_within_max', 'Each subject mark is within its maximum', msg),
      na('total_matches_marks', 'Printed total equals the sum of subject marks', msg),
      na('percentage_matches_marks', 'Printed percentage agrees with subject marks', msg),
    ];
  }

  const sumObtained = rows.reduce((s, r) => s + r.obtained!, 0);
  const sumMax = rows.reduce((s, r) => s + r.max!, 0);
  const over = rows.filter((r) => r.obtained! > r.max!);
  const checks: CheckResult[] = [
    {
      code: 'subject_marks_within_max',
      label: 'Each subject mark is within its maximum',
      status: over.length ? 'fail' : 'pass',
      message: over.length ? `Marks exceed maximum in: ${over.map((r) => r.name).join(', ')}` : `All ${rows.length} subjects within maximum`,
    },
  ];

  const printedTotal = toNumber(fields.total_obtained);
  checks.push(
    printedTotal === null
      ? na('total_matches_marks', 'Printed total equals the sum of subject marks', 'Printed total not available')
      : {
          code: 'total_matches_marks',
          label: 'Printed total equals the sum of subject marks',
          status: printedTotal === sumObtained ? 'pass' : 'fail',
          expected: sumObtained,
          actual: printedTotal,
          message: printedTotal === sumObtained ? `Total ${printedTotal} matches` : `Subject marks sum to ${sumObtained}, printed total is ${printedTotal}`,
        },
  );

  const recomputed = round2((sumObtained / sumMax) * 100);
  const printedPct = toNumber(fields.percentage);
  checks.push(
    printedPct === null
      ? { ...na('percentage_matches_marks', 'Printed percentage agrees with subject marks', 'Printed percentage not available'), expected: recomputed }
      : {
          code: 'percentage_matches_marks',
          label: 'Printed percentage agrees with subject marks',
          status: Math.abs(printedPct - recomputed) <= tolerance ? 'pass' : 'fail',
          expected: recomputed,
          actual: printedPct,
          message:
            Math.abs(printedPct - recomputed) <= tolerance
              ? `Recomputed ${recomputed}% matches printed ${printedPct}%`
              : `Recomputed ${recomputed}% (${sumObtained}/${sumMax}) disagrees with printed ${printedPct}%`,
        },
  );
  return checks;
}

const parseDate = (v: string | null | undefined) => {
  const m = v?.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
};

export function checkIncomeCertificate(fields: FieldValues, now = new Date()): CheckResult[] {
  const income = toNumber(fields.annual_income);
  const issued = parseDate(fields.issue_date);
  const ageDays = issued ? (now.getTime() - issued.getTime()) / 86_400_000 : null;
  return [
    {
      code: 'income_is_numeric',
      label: 'Annual income is a valid amount',
      status: income !== null && income >= 0 ? 'pass' : 'fail',
      actual: fields.annual_income ?? null,
      message: income !== null && income >= 0 ? `Income read as ${income}` : 'Annual income could not be read as an amount',
    },
    ageDays === null
      ? { code: 'certificate_current', label: 'Certificate issued within the last 12 months', status: 'not_applicable', message: 'Issue date not available' }
      : {
          code: 'certificate_current',
          label: 'Certificate issued within the last 12 months',
          status: ageDays >= 0 && ageDays <= 366 ? 'pass' : 'fail',
          actual: fields.issue_date,
          message: ageDays < 0 ? 'Issue date is in the future' : ageDays <= 366 ? 'Certificate is current' : 'Certificate is older than 12 months',
        },
  ];
}

// Verhoeff checksum used by 12-digit national ID numbers.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export const verhoeffValid = (digits: string) =>
  /^\d+$/.test(digits) && digits.split('').reverse().reduce((c, d, i) => D[c][P[i % 8][Number(d)]], 0) === 0;

export function checkIdentity(fields: FieldValues, now = new Date()): CheckResult[] {
  const id = fields.id_number?.replace(/\s/g, '') ?? '';
  const dob = parseDate(fields.date_of_birth);
  const age = dob ? (now.getTime() - dob.getTime()) / (365.25 * 86_400_000) : null;
  return [
    /^\d{12}$/.test(id)
      ? { code: 'id_checksum', label: 'ID number checksum is valid', status: verhoeffValid(id) ? 'pass' : 'fail', message: verhoeffValid(id) ? 'Checksum valid' : 'Checksum digit does not match — likely a misread or mistyped number' }
      : { code: 'id_checksum', label: 'ID number checksum is valid', status: 'not_applicable', message: 'ID number is not a 12-digit number' },
    age === null
      ? { code: 'dob_plausible', label: 'Date of birth is plausible', status: 'not_applicable', message: 'Date of birth not available' }
      : { code: 'dob_plausible', label: 'Date of birth is plausible', status: age >= 10 && age <= 100 ? 'pass' : 'fail', message: `Age computed as ${Math.floor(age)} years` },
  ];
}

export function runConsistencyChecks(documentType: string | null, fields: FieldValues, tolerance: number): CheckResult[] {
  switch (documentType) {
    case 'marksheet':
      return checkMarksheet(fields, tolerance);
    case 'income_certificate':
      return checkIncomeCertificate(fields);
    case 'identity':
      return checkIdentity(fields);
    default:
      return [];
  }
}
