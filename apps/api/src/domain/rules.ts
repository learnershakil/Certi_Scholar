import { z } from 'zod';
import { FACT_CATALOG, type FactText, type FactType } from './facts.js';

/**
 * Scholarship rule engine (M8). Rules are data: nested AND/OR groups of conditions over named facts.
 * Evaluation is three-valued — a condition whose fact is unavailable is `unknown`, never silently a pass or fail.
 */

export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'is_true', 'is_false', 'exists'] as const;
export type Operator = (typeof OPERATORS)[number];
export type Outcome = 'pass' | 'fail' | 'unknown';

export type RuleNode =
  | { type: 'group'; op: 'AND' | 'OR'; label?: string; children: RuleNode[] }
  | { type: 'condition'; fact: string; operator: Operator; value?: unknown; label?: string };

export interface NodeResult {
  type: 'group' | 'condition';
  label: string;
  outcome: Outcome;
  reason: string;
  op?: 'AND' | 'OR';
  fact?: string;
  operator?: Operator;
  expected?: unknown;
  actual?: unknown;
  children?: NodeResult[];
}

export type FactSet = Record<string, unknown>;

const OPERATORS_BY_TYPE: Record<FactType, Operator[]> = {
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  boolean: ['is_true', 'is_false', 'exists'],
  enum: ['eq', 'neq', 'in', 'not_in', 'exists'],
  string: ['eq', 'neq', 'in', 'not_in', 'exists'],
};

const OPERATOR_TEXT: Record<Operator, string> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  in: 'is one of',
  not_in: 'is not one of',
  is_true: 'is true',
  is_false: 'is false',
  exists: 'is available',
};

const MAX_DEPTH = 6;

const conditionSchema = z.object({
  type: z.literal('condition'),
  fact: z.string(),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
  label: z.string().max(200).optional(),
});

export const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({
      type: z.literal('group'),
      op: z.enum(['AND', 'OR']),
      label: z.string().max(200).optional(),
      children: z.array(ruleNodeSchema).min(1),
    }),
  ]),
) as z.ZodType<RuleNode>;

/** Structural + semantic validation against the fact catalog. Returns a list of problems (empty = valid). */
export function validateRule(node: RuleNode, depth = 0, path = 'root'): string[] {
  if (depth > MAX_DEPTH) return [`${path}: nesting deeper than ${MAX_DEPTH} levels`];
  if (node.type === 'group') return node.children.flatMap((c, i) => validateRule(c, depth + 1, `${path}.${i}`));
  const fact = FACT_CATALOG[node.fact];
  if (!fact) return [`${path}: unknown fact "${node.fact}"`];
  if (!OPERATORS_BY_TYPE[fact.type].includes(node.operator)) {
    return [`${path}: operator "${node.operator}" is not valid for ${fact.type} fact "${node.fact}"`];
  }
  const v = node.value;
  if (['gt', 'gte', 'lt', 'lte'].includes(node.operator) && typeof v !== 'number') return [`${path}: value must be a number`];
  if (node.operator === 'between' && !(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number'))) {
    return [`${path}: "between" needs [min, max]`];
  }
  if (['in', 'not_in'].includes(node.operator) && !(Array.isArray(v) && v.length > 0)) return [`${path}: value must be a non-empty list`];
  if (fact.type === 'enum' && fact.options) {
    const values = Array.isArray(v) ? v : v === undefined ? [] : [v];
    const bad = values.filter((x) => !fact.options!.includes(String(x)));
    if (bad.length) return [`${path}: ${bad.join(', ')} not allowed for "${node.fact}"`];
  }
  return [];
}

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '—' : String(v));

function evaluateCondition(node: Extract<RuleNode, { type: 'condition' }>, facts: FactSet, text: FactText): NodeResult {
  const name = text[node.fact]?.label || node.fact;
  const label = node.label || `${name} ${OPERATOR_TEXT[node.operator]}${node.value !== undefined ? ` ${fmt(node.value)}` : ''}`;
  const actual = facts[node.fact];
  const base = { type: 'condition' as const, label, fact: node.fact, operator: node.operator, expected: node.value, actual };

  if (node.operator === 'exists') {
    const ok = actual !== undefined && actual !== null;
    return { ...base, outcome: ok ? 'pass' : 'fail', reason: ok ? `${name} is available` : `${name} is not available` };
  }
  if (actual === undefined || actual === null) {
    return { ...base, outcome: 'unknown', reason: `${name} is not available from the submitted documents` };
  }

  const v = node.value as never;
  let ok: boolean;
  switch (node.operator) {
    case 'eq': ok = actual === v; break;
    case 'neq': ok = actual !== v; break;
    case 'gt': ok = Number(actual) > v; break;
    case 'gte': ok = Number(actual) >= v; break;
    case 'lt': ok = Number(actual) < v; break;
    case 'lte': ok = Number(actual) <= v; break;
    case 'between': ok = Number(actual) >= (v as number[])[0] && Number(actual) <= (v as number[])[1]; break;
    case 'in': ok = (v as unknown[]).includes(actual); break;
    case 'not_in': ok = !(v as unknown[]).includes(actual); break;
    case 'is_true': ok = actual === true; break;
    case 'is_false': ok = actual === false; break;
  }
  return {
    ...base,
    outcome: ok ? 'pass' : 'fail',
    reason: `${name} is ${fmt(actual)}; required: ${OPERATOR_TEXT[node.operator]}${node.value !== undefined ? ` ${fmt(node.value)}` : ''}`,
  };
}

/** `text` gives facts their display names in the explanation; without it the fact key is shown. */
export function evaluate(node: RuleNode, facts: FactSet, text: FactText = {}): NodeResult {
  if (node.type === 'condition') return evaluateCondition(node, facts, text);

  const children = node.children.map((c) => evaluate(c, facts, text));
  const outcomes = children.map((c) => c.outcome);
  let outcome: Outcome;
  if (node.op === 'AND') outcome = outcomes.includes('fail') ? 'fail' : outcomes.includes('unknown') ? 'unknown' : 'pass';
  else outcome = outcomes.includes('pass') ? 'pass' : outcomes.includes('unknown') ? 'unknown' : 'fail';

  const passed = outcomes.filter((o) => o === 'pass').length;
  const reason =
    node.op === 'AND'
      ? `All ${children.length} conditions required — ${passed} met, ${outcomes.filter((o) => o === 'fail').length} not met, ${outcomes.filter((o) => o === 'unknown').length} undetermined`
      : `At least one of ${children.length} conditions required — ${passed} met`;
  return { type: 'group', op: node.op, label: node.label || (node.op === 'AND' ? 'All of' : 'Any of'), outcome, reason, children };
}

/** Flattens a result tree into a numbered list for reports ("1.2  Income is at most 250000 — fail"). */
export function flattenResult(r: NodeResult, prefix = ''): Array<{ ref: string; depth: number; result: NodeResult }> {
  const rows = [{ ref: prefix || 'root', depth: prefix ? prefix.split('.').length : 0, result: r }];
  r.children?.forEach((c, i) => rows.push(...flattenResult(c, prefix ? `${prefix}.${i + 1}` : `${i + 1}`)));
  return rows;
}
