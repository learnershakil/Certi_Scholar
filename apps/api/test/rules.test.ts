import { describe, expect, it } from 'vitest';
import { evaluate, flattenResult, ruleNodeSchema, validateRule, type RuleNode } from '../src/domain/rules.js';
import { RULES, SETTINGS_DEFAULTS } from '../src/seedData.js';
import type { FactText } from '../src/domain/facts.js';

const FACT_TEXT = SETTINGS_DEFAULTS.factText as FactText;

const cond = (fact: string, operator: string, value?: unknown) => ({ type: 'condition', fact, operator, value }) as RuleNode;

describe('rule engine — operators', () => {
  const cases: Array<[string, unknown, string, unknown, 'pass' | 'fail']> = [
    ['marksheet.percentage', 80, 'gte', 80, 'pass'],
    ['marksheet.percentage', 79.99, 'gte', 80, 'fail'],
    ['marksheet.percentage', 81, 'gt', 80, 'pass'],
    ['marksheet.percentage', 80, 'gt', 80, 'fail'],
    ['income.annualIncome', 250000, 'lte', 250000, 'pass'],
    ['income.annualIncome', 250001, 'lte', 250000, 'fail'],
    ['income.annualIncome', 100, 'lt', 101, 'pass'],
    ['marksheet.percentage', 70, 'between', [60, 75], 'pass'],
    ['marksheet.percentage', 76, 'between', [60, 75], 'fail'],
    ['applicant.category', 'SC', 'in', ['SC', 'ST'], 'pass'],
    ['applicant.category', 'GEN', 'in', ['SC', 'ST'], 'fail'],
    ['applicant.category', 'GEN', 'not_in', ['SC', 'ST'], 'pass'],
    ['applicant.gender', 'female', 'eq', 'female', 'pass'],
    ['applicant.gender', 'male', 'neq', 'female', 'pass'],
    ['marksheet.consistent', true, 'is_true', undefined, 'pass'],
    ['marksheet.consistent', false, 'is_true', undefined, 'fail'],
    ['marksheet.consistent', false, 'is_false', undefined, 'pass'],
  ];
  it.each(cases)('%s=%s %s %s → %s', (fact, actual, op, value, expected) => {
    expect(evaluate(cond(fact, op, value), { [fact]: actual }).outcome).toBe(expected);
  });

  it('treats a missing fact as unknown, not as a pass or fail', () => {
    const r = evaluate(cond('income.annualIncome', 'lte', 250000), {});
    expect(r.outcome).toBe('unknown');
    expect(r.reason).toMatch(/not available/);
  });

  it('exists is decided even when the fact is missing', () => {
    expect(evaluate(cond('income.annualIncome', 'exists'), {}).outcome).toBe('fail');
    expect(evaluate(cond('income.annualIncome', 'exists'), { 'income.annualIncome': 1 }).outcome).toBe('pass');
  });
});

describe('rule engine — AND/OR with three-valued logic', () => {
  const and: RuleNode = { type: 'group', op: 'AND', children: [cond('marksheet.percentage', 'gte', 60), cond('income.annualIncome', 'lte', 100)] };
  const or: RuleNode = { type: 'group', op: 'OR', children: [cond('marksheet.percentage', 'gte', 60), cond('income.annualIncome', 'lte', 100)] };

  it.each([
    [and, { 'marksheet.percentage': 70, 'income.annualIncome': 50 }, 'pass'],
    [and, { 'marksheet.percentage': 70, 'income.annualIncome': 500 }, 'fail'],
    [and, { 'marksheet.percentage': 70 }, 'unknown'],
    [and, { 'marksheet.percentage': 50 }, 'fail'], // a definite fail outweighs unknown
    [or, { 'marksheet.percentage': 50, 'income.annualIncome': 50 }, 'pass'],
    [or, { 'marksheet.percentage': 50, 'income.annualIncome': 500 }, 'fail'],
    [or, { 'marksheet.percentage': 50 }, 'unknown'],
    [or, { 'marksheet.percentage': 70 }, 'pass'], // a definite pass outweighs unknown
  ] as const)('case %#', (rule, facts, expected) => {
    expect(evaluate(rule, facts).outcome).toBe(expected);
  });

  it('explains every condition with actual and expected values', () => {
    const r = evaluate(and, { 'marksheet.percentage': 70, 'income.annualIncome': 500 }, FACT_TEXT);
    const rows = flattenResult(r);
    expect(rows.map((x) => x.ref)).toEqual(['root', '1', '2']);
    expect(rows[2].result).toMatchObject({ outcome: 'fail', actual: 500, expected: 100 });
    expect(rows[2].result.reason).toBe('Annual family income (INR) is 500; required: is at most 100');
    expect(r.reason).toMatch(/1 met, 1 not met, 0 undetermined/);
  });
});

describe('rule validation', () => {
  it('accepts the seeded live rule sets', () => {
    for (const rule of Object.values(RULES)) {
      expect(ruleNodeSchema.safeParse(rule).success).toBe(true);
      expect(validateRule(rule)).toEqual([]);
    }
  });

  it.each([
    [cond('nope.fact', 'eq', 1), /unknown fact/],
    [cond('marksheet.consistent', 'gte', 1), /not valid for boolean/],
    [cond('marksheet.percentage', 'gte', '60'), /must be a number/],
    [cond('marksheet.percentage', 'between', [60]), /\[min, max\]/],
    [cond('applicant.category', 'in', []), /non-empty list/],
    [cond('applicant.category', 'in', ['XYZ']), /not allowed/],
  ])('rejects invalid rule %#', (rule, message) => {
    expect(validateRule(rule).join()).toMatch(message);
  });

  it('rejects excessive nesting', () => {
    let node: RuleNode = cond('marksheet.percentage', 'gte', 1);
    for (let i = 0; i < 8; i++) node = { type: 'group', op: 'AND', children: [node] };
    expect(validateRule(node).join()).toMatch(/nesting/);
  });

  it('rejects structurally invalid trees', () => {
    expect(ruleNodeSchema.safeParse({ type: 'group', op: 'XOR', children: [] }).success).toBe(false);
    expect(ruleNodeSchema.safeParse({ type: 'group', op: 'AND', children: [] }).success).toBe(false);
  });
});

describe('live scholarship fixture set', () => {
  const eligible = {
    'applicant.gender': 'female',
    'applicant.category': 'OBC',
    'marksheet.percentage': 88.2,
    'marksheet.consistent': true,
    'income.annualIncome': 240000,
    'identity.provided': true,
    'documents.reviewComplete': true,
    'documents.authenticityEstablished': true,
  };
  const fixtures: Array<[string, Record<string, unknown>, 'pass' | 'fail' | 'unknown']> = [
    ['MCM-2026', eligible, 'pass'],
    ['MCM-2026', { ...eligible, 'marksheet.percentage': 59.9 }, 'fail'],
    ['MCM-2026', { ...eligible, 'income.annualIncome': 250001 }, 'fail'],
    ['MCM-2026', { ...eligible, 'marksheet.consistent': false }, 'fail'],
    ['MCM-2026', { ...eligible, 'documents.authenticityEstablished': false }, 'fail'],
    ['MCM-2026', { ...eligible, 'income.annualIncome': undefined }, 'unknown'],
    ['GSTEM-2026', eligible, 'pass'],
    ['GSTEM-2026', { ...eligible, 'applicant.gender': 'male' }, 'fail'],
    ['GSTEM-2026', { ...eligible, 'marksheet.percentage': 74 }, 'fail'],
    ['GSTEM-2026', { ...eligible, 'income.annualIncome': 900000 }, 'fail'],
    ['GSTEM-2026', { ...eligible, 'income.annualIncome': 900000, 'applicant.category': 'ST' }, 'pass'],
    ['GSTEM-2026', { ...eligible, 'identity.provided': false }, 'fail'],
  ];
  it.each(fixtures)('%s fixture %#', (code, facts, expected) => {
    expect(evaluate(RULES[code], facts).outcome).toBe(expected);
  });
});

describe('fact wording', () => {
  it('uses the configured label, and the fact key when none is configured', () => {
    const c: RuleNode = { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 100 };
    expect(evaluate(c, { 'income.annualIncome': 50 }, { 'income.annualIncome': { label: 'Household income' } }).reason).toBe('Household income is 50; required: is at most 100');
    expect(evaluate(c, { 'income.annualIncome': 50 }).reason).toBe('income.annualIncome is 50; required: is at most 100');
  });
});
