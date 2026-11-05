'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType, inr } from '@/lib/format';
import type { Application, DocumentSummary, Scholarship } from '@/lib/types';
import { useMe } from '@/components/AppShell';
import { Card, Empty, ErrorText, Loading, PageHead, StatusPill } from '@/components/ui';

function Apply({ onDone }: { onDone: () => void }) {
  const scholarships = useApi<Scholarship[]>('/scholarships');
  const docs = useApi<DocumentSummary[]>('/documents');
  const [scholarshipId, setScholarshipId] = useState('');
  // Preselect the scholarship chosen on the dashboard (?scholarship=<id>).
  useEffect(() => setScholarshipId(new URLSearchParams(window.location.search).get('scholarship') ?? ''), []);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scholarship = scholarships.data?.find((s) => s._id === scholarshipId);
  const usable = useMemo(() => docs.data?.filter((d) => !['rejected', 'purged'].includes(d.status)) ?? [], [docs.data]);
  const required = scholarship?.requiredDocuments ?? [];

  // Choosing a scholarship attaches the newest document of each type it requires; the student can change the choice.
  useEffect(() => {
    if (!scholarship) return setSelected([]);
    setSelected(scholarship.requiredDocuments.map((t) => usable.find((d) => d.documentType === t)?.id).filter((id): id is string => Boolean(id)));
  }, [scholarship, usable]);

  const attachedTypes = new Set(usable.filter((d) => selected.includes(d.id)).map((d) => d.documentType));
  const missing = required.filter((t) => !attachedTypes.has(t));
  const processing = usable.some((d) => !d.documentType && ['queued', 'processing'].includes(d.status));

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await post('/applications', { scholarshipId, documentIds: selected });
      setScholarshipId('');
      setSelected([]);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Apply for a scholarship">
      <div className="grid grid-2">
        <div>
          <label className="label" htmlFor="sch">Scholarship</label>
          <select id="sch" className="select" value={scholarshipId} onChange={(e) => setScholarshipId(e.target.value)}>
            <option value="">Select…</option>
            {scholarships.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          {scholarship && (
            <>
              <div className="notice" style={{ marginTop: 12 }}>
                <div className="row-between"><strong>{inr(scholarship.amount)}</strong><Link className="small" href="/dashboard">Eligibility criteria</Link></div>
                {scholarship.description && <div className="small" style={{ marginTop: 4 }}>{scholarship.description}</div>}
              </div>
              <span className="label" style={{ marginTop: 16 }}>Required documents</span>
              <ul className="detail-docs" aria-label="Required documents">
                {required.map((t) => {
                  const have = attachedTypes.has(t);
                  const uploaded = usable.some((d) => d.documentType === t);
                  return (
                    <li key={t}>
                      <span>{docType(t)}</span>
                      {have ? (
                        <StatusPill status="success" tone="success" label="Attached" />
                      ) : uploaded ? (
                        <StatusPill status="warning" tone="warning" label="Select it on the right" />
                      ) : (
                        <Link href="/documents"><StatusPill status="danger" tone="danger" label="Not uploaded · upload" /></Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div>
          <span className="label">Attach documents</span>
          {usable.length === 0 ? (
            <div className="small muted">Upload documents first, on <Link href="/documents">My documents</Link>.</div>
          ) : (
            <div className="check-list">
              {usable.map((d) => (
                <label key={d.id}>
                  <input type="checkbox" checked={selected.includes(d.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))} />
                  <span className="grow">{d.originalName}</span>
                  <span className="small faint">{d.documentType ? docType(d.documentType) : 'Being identified…'}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy || !scholarship || missing.length > 0} onClick={submit}>Submit application</button>
        {scholarship && missing.length > 0 && (
          <span className="small muted" role="status">
            Attach {missing.map(docType).join(', ')} to apply.{processing ? ' A document you uploaded is still being identified; it can be attached once processed.' : ''}
          </span>
        )}
      </div>
    </Card>
  );
}

export default function ApplicationsPage() {
  const me = useMe();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<Application[]>(`/applications${status ? `?status=${status}` : ''}`);

  return (
    <>
      <PageHead
        title={me.role === 'student' ? 'My applications' : 'Applications'}
        actions={
          me.role !== 'student' && (
            <select className="select" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {['submitted', 'under_review', 'evaluated', 'awarded', 'rejected'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          )
        }
      />
      <div className="stack">
        {me.role === 'student' && <Apply onDone={reload} />}
        <Card flush title="Applications">
          <ErrorText error={error} />
          {loading ? (
            <Loading />
          ) : !data?.length ? (
            <Empty>No applications.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  {me.role !== 'student' && <th>Applicant</th>}
                  <th>Scholarship</th>
                  <th>Status</th>
                  <th>Recommendation</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a._id} className="clickable" onClick={() => router.push(`/applications/${a._id}`)}>
                    {me.role !== 'student' && (
                      <td>
                        <Link href={`/applications/${a._id}`}>{a.student.name}</Link>
                        <div className="small faint">{[a.student.profile?.gender, a.student.profile?.state].filter(Boolean).join(' · ')}</div>
                      </td>
                    )}
                    <td>{me.role === 'student' ? <Link href={`/applications/${a._id}`}>{a.scholarship.name}</Link> : a.scholarship.name}</td>
                    <td><StatusPill status={a.status} /></td>
                    <td>{a.latestRecommendation ? <StatusPill status={a.latestRecommendation.outcome} /> : <span className="faint">Pending</span>}</td>
                    <td className="muted">{dateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
