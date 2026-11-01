'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType } from '@/lib/format';
import type { DocumentSummary } from '@/lib/types';
import { useMe } from '@/components/AppShell';
import { Card, Empty, ErrorText, Loading, PageHead, StatusPill } from '@/components/ui';

const ACTIVE = ['queued', 'processing'];

function Upload({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [declaredType, setDeclaredType] = useState('');

  const send = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.append('file', file);
    if (declaredType) form.append('declaredType', declaredType);
    try {
      const res = await fetch('/api/v1/documents', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code, body?.error?.message ?? 'Upload failed');
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div
      className={`dropzone${drag ? ' drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void send(e.dataTransfer.files[0]); }}
    >
      <p style={{ margin: '0 0 8px' }}>Drop a marksheet, income certificate or identity document here</p>
      <p className="small muted" style={{ margin: '0 0 12px' }}>PDF, PNG or JPEG · up to 10 MB · scanned for malware and stored encrypted</p>
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => send(e.target.files?.[0])} aria-label="Choose document" />
      <div className="row" style={{ justifyContent: 'center' }}>
        <select className="select" style={{ width: 240 }} value={declaredType} onChange={(e) => setDeclaredType(e.target.value)} aria-label="Document type">
          <option value="">Detect type automatically</option>
          <option value="marksheet">Statement of marks</option>
          <option value="income_certificate">Income certificate</option>
          <option value="identity">Identity document</option>
        </select>
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : 'Choose file'}
        </button>
      </div>
      {error && <div style={{ marginTop: 12 }}><ErrorText error={error} /></div>}
    </div>
  );
}

export default function DocumentsPage() {
  const me = useMe();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<DocumentSummary[]>('/documents', {
    pollMs: 2500,
    pollWhile: (docs) => docs.some((d) => ACTIVE.includes(d.status)),
  });

  return (
    <>
      <PageHead
        title={me.role === 'student' ? 'My documents' : 'Documents'}
        subtitle={me.role === 'student' ? 'Upload documents once and attach them to any scholarship application.' : 'Documents within your assigned cases.'}
      />
      <div className="stack">
        {me.role === 'student' && <Upload onDone={reload} />}
        <Card flush title="Documents">
          <ErrorText error={error} />
          {loading ? (
            <Loading />
          ) : !data?.length ? (
            <Empty>No documents yet.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Processing</th>
                  <th>Verification</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => router.push(`/documents/${d.id}`)}>
                    <td><Link href={`/documents/${d.id}`}>{d.originalName}</Link></td>
                    <td>{docType(d.documentType)}</td>
                    <td><StatusPill status={d.status} /></td>
                    <td>
                      <StatusPill status={d.verification.status} />
                      {d.verification.simulated && <span className="simulated-tag" style={{ marginLeft: 6 }}>SIMULATED</span>}
                    </td>
                    <td className="muted">{dateTime(d.createdAt)}</td>
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
