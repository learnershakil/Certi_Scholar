'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExtractedField } from '@/lib/types';
import { ConfidenceMeter, StatusPill } from './ui';

interface Props {
  fields: ExtractedField[];
  activeKey?: string | null;
  onSelect: (key: string) => void;
  editable: boolean;
  onCorrect: (key: string, value: string, reason: string) => Promise<void>;
  onConfirm: (key: string) => Promise<void>;
}

function FieldRow({ field, active, onSelect, editable, onCorrect, onConfirm }: Omit<Props, 'fields' | 'activeKey' | 'onSelect'> & { field: ExtractedField; active: boolean; onSelect: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);
  const low = field.status === 'needs_review';

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      setEditing(false);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className={`field-row${active ? ' active' : ''}${low ? ' low' : ''}`} onClick={onSelect} data-testid={`field-${field.key}`}>
      <div className="field-label">{field.label}</div>
      {editing ? (
        <form
          className="stack"
          style={{ gap: 6 }}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onCorrect(field.key, value.trim(), reason.trim()));
          }}
        >
          <input className="input" aria-label={`Corrected ${field.label}`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          <input className="input" aria-label="Reason for correction" placeholder="Reason (required, recorded in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy || !value.trim() || reason.trim().length < 3}>Save correction</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div>
          <div className={`field-value${field.value === null ? ' missing' : ''}`}>{field.value ?? 'Not read — needs entry'}</div>
          <div className="row small" style={{ marginTop: 3 }}>
            <ConfidenceMeter value={field.confidence.overall} threshold={field.confidence.threshold} />
            {field.status !== 'auto_accepted' && <StatusPill status={field.status} />}
          </div>
        </div>
      )}
      {!editing && editable && (
        <div className="row" onClick={(e) => e.stopPropagation()}>
          {low && field.value !== null && (
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => onConfirm(field.key))}>
              Confirm
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Correct
          </button>
        </div>
      )}
    </div>
  );
}

export function FieldList({ fields, activeKey, onSelect, ...rest }: Props) {
  const scalar = fields.filter((f) => !f.group);
  const rows = new Map<number, ExtractedField[]>();
  for (const f of fields.filter((f) => f.group)) rows.set(f.row!, [...(rows.get(f.row!) ?? []), f]);

  return (
    <div>
      {scalar.map((f) => (
        <FieldRow key={f.key} field={f} active={activeKey === f.key} onSelect={() => onSelect(f.key)} {...rest} />
      ))}
      {rows.size > 0 && (
        <>
          <div className="small muted" style={{ padding: '12px 12px 4px', fontWeight: 600 }}>
            Subject marks
          </div>
          {[...rows.values()].flat().map((f) => (
            <FieldRow key={f.key} field={f} active={activeKey === f.key} onSelect={() => onSelect(f.key)} {...rest} />
          ))}
        </>
      )}
    </div>
  );
}
