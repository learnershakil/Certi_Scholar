'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType, humanize, inr } from '@/lib/format';
import type { Application, Recommendation, TimelineEntry } from '@/lib/types';
import { useMe } from '@/components/AppShell';
import { EvaluationTree, Timeline } from '@/components/Progress';
import { Card, ErrorText, Loading, Notice, PageHead, StatusPill } from '@/components/ui';

const showValue = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : String(v));

const OUTCOME_TEXT ={ recommended: 'Recommended', not_recommended: 'Not recommended', needs_review: 'Cannot be decided yet' };

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const app = useApi<Application>(`/applications/${id}`);
  const rec = useApi<Recommendation>(`/applications/${id}/recommendation`, { pollMs: 2500, pollWhile: () => false, retryOnError: true });
  const timeline = useApi<TimelineEntry[]>(`/applications/${id}/timeline`);
  const factNames = useApi<{ facts: Record<string, { label: string }> }>('/scholarships/facts');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const officer = me.role === 'scholarship_officer' || me.role === 'admin';

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await Promise.all([app.reload(), rec.reload(), timeline.reload()]);
      setNote('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (app.error) return <ErrorText error={app.error} />;
  if (!app.data) return <Loading />;
  const a = app.data;
  const r = rec.data;
  const decided = ['awarded', 'rejected'].includes(a.status);
  const docs = (a.documents as Exclude<Application['documents'], string[]>) ?? [];

  return (
    <>
      <PageHead
        title={a.scholarship.name}
        subtitle={<span className="row">{a.student.name} · submitted {dateTime(a.createdAt)} <StatusPill status={a.status} /></span>}
        actions={officer && !decided && <button className="btn" onClick={() => act(() => post(`/applications/${id}/recommendation`))}>Re-evaluate</button>}
      />
      <div className="stack">
        <ErrorText error={error} />
        {!r ? (
          <Notice tone="info">The recommendation is being prepared. It is generated automatically once documents are processed.</Notice>
        ) : (
          <>
            <Notice tone={r.outcome === 'recommended' ? 'success' : r.outcome === 'not_recommended' ? 'danger' : 'warning'}>
              <div className="row-between">
                <strong>{OUTCOME_TEXT[r.outcome]}</strong>
                <span className="small faint">Rule set v{r.ruleVersion} · {dateTime(r.createdAt)}</span>
              </div>
              <div style={{ marginTop: 4 }}>{r.summary}</div>
            </Notice>

            <div className="grid grid-2">
              <Card title="Conditions evaluated">
                <EvaluationTree node={r.evaluation} />
              </Card>
              <div className="stack">
                <Card flush title="Facts used">
                  {Object.entries(r.facts).map(([k, f]) => (
                    <dl key={k} className="kv">
                      <dt>{factNames.data?.facts[k]?.label ?? humanize(k.replace(".", " "))}</dt>
                      <dd>
                        {showValue(f.value)}
                        <div className="small muted">{f.source}{f.note ? ` — ${f.note}` : ''}</div>
                      </dd>
                    </dl>
                  ))}
                </Card>
                <Card flush title="What has been established about each document">
                  <table className="table">
                    <tbody>
                      {r.authenticity.map((d) => (
                        <tr key={d.documentId}>
                          <td>
                            <Link href={`/documents/${d.documentId}`}>{d.name}</Link>
                            <div className="small faint">{docType(d.documentType)}</div>
                          </td>
                          <td>
                            <StatusPill status={d.verificationStatus} />
                            <div className="small" style={{ marginTop: 4 }}>{d.text}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          </>
        )}

        <div className="grid grid-2">
          <Card title="Decision">
            {decided ? (
              <div>
                <StatusPill status={a.status} /> <span className="muted small">{dateTime(a.decision?.at)}</span>
                <p>{a.decision?.note}</p>
              </div>
            ) : officer ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="small muted">Award amount {inr(a.scholarship.amount)}. The recommendation informs this decision; it does not make it.</div>
                <textarea className="textarea" placeholder="Decision note (recorded)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
                <div className="row">
                  <button className="btn btn-primary" disabled={!r || note.trim().length < 3} onClick={() => act(() => post(`/applications/${id}/decision`, { outcome: 'awarded', note }))}>Award</button>
                  <button className="btn btn-danger" disabled={!r || note.trim().length < 3} onClick={() => act(() => post(`/applications/${id}/decision`, { outcome: 'rejected', note }))}>Reject</button>
                </div>
              </div>
            ) : (
              <div className="muted">Awaiting decision by the scholarship office.</div>
            )}
            <div style={{ marginTop: 16 }}>
              <div className="label">Attached documents</div>
              {docs.map((d) => (
                <div key={d._id} className="row small" style={{ padding: '3px 0' }}>
                  <Link href={`/documents/${d._id}`}>{d.originalName}</Link>
                  <span className="faint">{docType(d.documentType)} · {humanize(d.status)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Processing timeline">
            <Timeline entries={timeline.data ?? []} />
          </Card>
        </div>
      </div>
    </>
  );
}
