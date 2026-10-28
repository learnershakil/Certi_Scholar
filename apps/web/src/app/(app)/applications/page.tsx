'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scholarship = scholarships.data?.find((s) => s._id === scholarshipId);
  const usable = docs.data?.filter((d) => !['rejected', 'purged'].includes(d.status)) ?? [];

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
            <div className="small muted" style={{ marginTop: 8 }}>
              {scholarship.description} Award {inr(scholarship.amount)}. Requires: {scholarship.requiredDocuments.map(docType).join(', ')}.
            </div>
          )}
        </div>
        <div>
          <span className="label">Attach documents</span>
          {usable.length === 0 && <div className="small muted">Upload documents first.</div>}
          {usable.map((d) => (
            <label key={d.id} className="row small" style={{ padding: '3px 0' }}>
              <input type="checkbox" checked={selected.includes(d.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))} />
              {d.originalName} <span className="faint">· {docType(d.documentType)}</span>
            </label>
          ))}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy || !scholarshipId || !selected.length} onClick={submit}>Submit application</button>
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
                        <div className="small faint">{a.student.profile?.category} · {a.student.profile?.state}</div>
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
