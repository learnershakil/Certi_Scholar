'use client';

import type { FactDefinition, RuleNode } from '@/lib/types';

type Facts = Record<string, FactDefinition>;
type Condition = Extract<RuleNode, { type: 'condition' }>;
type Group = Extract<RuleNode, { type: 'group' }>;

const OPS: Record<FactDefinition['type'], Array<[string, string]>> = {
  number: [['gte', 'is at least'], ['lte', 'is at most'], ['gt', 'is greater than'], ['lt', 'is less than'], ['eq', 'equals'], ['neq', 'does not equal'], ['between', 'is between'], ['exists', 'is available']],
  boolean: [['is_true', 'is true'], ['is_false', 'is false'], ['exists', 'is available']],
  enum: [['eq', 'equals'], ['neq', 'does not equal'], ['in', 'is one of'], ['not_in', 'is not one of'], ['exists', 'is available']],
  string: [['eq', 'equals'], ['neq', 'does not equal'], ['in', 'is one of'], ['not_in', 'is not one of'], ['exists', 'is available']],
};

/** Value expected by an operator for a fact type; used when the operator or fact changes. */
export function defaultValue(def: FactDefinition, operator: string): unknown {
  if (['is_true', 'is_false', 'exists'].includes(operator)) return undefined;
  if (operator === 'between') return [0, 100];
  if (operator === 'in' || operator === 'not_in') return def.options ? [def.options[0]] : [''];
  if (def.type === 'number') return 0;
  return def.options?.[0] ?? '';
}

function ValueInput({ def, node, onChange }: { def: FactDefinition; node: Condition; onChange: (v: unknown) => void }) {
  const op = node.operator;
  if (['is_true', 'is_false', 'exists'].includes(op)) return <span className="muted small">No value needed</span>;
  if (op === 'between') {
    const [lo, hi] = (node.value as number[]) ?? [0, 0];
    return (
      <div className="row">
        <input className="input" type="number" aria-label="Minimum" value={lo} onChange={(e) => onChange([Number(e.target.value), hi])} />
        <span className="muted">and</span>
        <input className="input" type="number" aria-label="Maximum" value={hi} onChange={(e) => onChange([lo, Number(e.target.value)])} />
      </div>
    );
  }
  if (op === 'in' || op === 'not_in') {
    const values = (node.value as string[]) ?? [];
    if (def.options) {
      return (
        <div className="row wrap">
          {def.options.map((o) => (
            <label key={o} className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={values.includes(o)} onChange={(e) => onChange(e.target.checked ? [...values, o] : values.filter((v) => v !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    return <input className="input" aria-label="Values (comma separated)" value={values.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
  }
  if (def.options) {
    return (
      <select className="select" aria-label="Value" value={String(node.value ?? '')} onChange={(e) => onChange(e.target.value)}>
        {def.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  return def.type === 'number' ? (
    <input className="input" type="number" aria-label="Value" value={Number(node.value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
  ) : (
    <input className="input" aria-label="Value" value={String(node.value ?? '')} onChange={(e) => onChange(e.target.value)} />
  );
}

function ConditionEditor({ node, facts, onChange, onRemove }: { node: Condition; facts: Facts; onChange: (n: RuleNode) => void; onRemove?: () => void }) {
  const def = facts[node.fact];
  return (
    <div className="rule-condition" data-testid="rule-condition">
      <select
        className="select"
        aria-label="Fact"
        value={node.fact}
        onChange={(e) => {
          const next = facts[e.target.value];
          const operator = OPS[next.type][0][0];
          onChange({ type: 'condition', fact: e.target.value, operator, value: defaultValue(next, operator) });
        }}
      >
        {Object.entries(facts).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
      </select>
      <select className="select" aria-label="Operator" value={node.operator} onChange={(e) => onChange({ ...node, operator: e.target.value, value: defaultValue(def, e.target.value) })}>
        {OPS[def.type].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ValueInput def={def} node={node} onChange={(value) => onChange({ ...node, value })} />
      {onRemove ? <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove condition" onClick={onRemove}>Remove</button> : <span />}
    </div>
  );
}

export function RuleBuilder({ value, facts, onChange, onRemove, depth = 0 }: { value: RuleNode; facts: Facts; onChange: (n: RuleNode) => void; onRemove?: () => void; depth?: number }) {
  if (value.type === 'condition') return <ConditionEditor node={value} facts={facts} onChange={onChange} onRemove={onRemove} />;
  const group = value as Group;
  const firstFact = Object.keys(facts)[0];
  const newCondition = (): RuleNode => {
    const def = facts[firstFact];
    const operator = OPS[def.type][0][0];
    return { type: 'condition', fact: firstFact, operator, value: defaultValue(def, operator) };
  };
  const setChild = (i: number, n: RuleNode) => onChange({ ...group, children: group.children.map((c, j) => (j === i ? n : c)) });
  const removeChild = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });

  return (
    <div className="rule-group" data-testid="rule-group">
      <div className="row-between">
        <div className="row">
          <select className="select" style={{ width: 'auto' }} aria-label="Group logic" value={group.op} onChange={(e) => onChange({ ...group, op: e.target.value as 'AND' | 'OR' })}>
            <option value="AND">All of the following (AND)</option>
            <option value="OR">Any of the following (OR)</option>
          </select>
          <input className="input" style={{ width: 240 }} placeholder="Group label (optional)" aria-label="Group label" value={group.label ?? ''} onChange={(e) => onChange({ ...group, label: e.target.value || undefined })} />
        </div>
        {onRemove && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>Remove group</button>}
      </div>
      <div className="rule-children">
        {group.children.map((c, i) => (
          <RuleBuilder key={i} value={c} facts={facts} depth={depth + 1} onChange={(n) => setChild(i, n)} onRemove={group.children.length > 1 ? () => removeChild(i) : undefined} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...group, children: [...group.children, newCondition()] })}>+ Condition</button>
        {depth < 4 && (
          <button type="button" className="btn btn-sm" onClick={() => onChange({ ...group, children: [...group.children, { type: 'group', op: 'OR', children: [newCondition()] }] })}>
            + Group
          </button>
        )}
      </div>
    </div>
  );
}
