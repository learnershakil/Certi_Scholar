import type { NodeResult, Stage, TimelineEntry } from '@/lib/types';
import { dateTime, humanize } from '@/lib/format';
import { StatusPill } from './ui';

export function StageTracker({ stages }: { stages: Stage[] }) {
  return (
    <div className="stages" aria-label="Processing stages">
      {stages.map((s) => (
        <div key={s.name} className={`stage ${s.status}`} data-testid={`stage-${s.name}`}>
          <div className="stage-name">{s.name === 'scan' ? 'Security scan' : s.name}</div>
          <div className="muted">
            {humanize(s.status)}
            {s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}
          </div>
          {s.error && <div className="small" style={{ color: 'var(--danger)' }}>{s.error}</div>}
        </div>
      ))}
    </div>
  );
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <div className="muted">No events yet.</div>;
  return (
    <ol className="timeline">
      {entries.map((e) => (
        <li key={e._id} className={e.status === 'failed' ? 't-failed' : 't-done'}>
          <div className="row-between">
            <strong style={{ textTransform: 'capitalize' }}>
              {e.stage} · {humanize(e.status)}
            </strong>
            <span className="small faint">{dateTime(e.createdAt)}</span>
          </div>
          <div className="small muted">
            {[e.document?.originalName, e.actor ? `by ${e.actor.name}` : 'system', e.durationMs !== undefined ? `${e.durationMs} ms` : null].filter(Boolean).join(' · ')}
          </div>
          {e.message && <div className="small">{e.message}</div>}
        </li>
      ))}
    </ol>
  );
}

const OUTCOME_LABEL = { pass: 'Met', fail: 'Not met', unknown: 'Undetermined' };

/** Condition-by-condition explanation of an evaluation. */
export function EvaluationTree({ node, depth = 0 }: { node: NodeResult; depth?: number }) {
  return (
    <div className="eval-node" style={depth === 0 ? { borderLeft: 0, paddingLeft: 0 } : undefined} data-testid="eval-node">
      <div className="row">
        <StatusPill status={node.outcome} label={OUTCOME_LABEL[node.outcome]} />
        <span style={{ fontWeight: node.type === 'group' ? 600 : 500 }}>{node.label}</span>
      </div>
      <div className="eval-reason">{node.reason}</div>
      {node.children?.map((c, i) => <EvaluationTree key={i} node={c} depth={depth + 1} />)}
    </div>
  );
}
