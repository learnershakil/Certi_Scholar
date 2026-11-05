'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType } from '@/lib/format';
import type { DocumentSummary } from '@/lib/types';
import { useDocTypes, useMe } from '@/components/AppShell';
import { Card, Empty, ErrorText, Loading, PageHead, StatusPill } from '@/components/ui';

const ACTIVE = ['queued', 'processing'];

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A reason for each failure the server can give without a message of its own (for example from a proxy). */
const uploadFailure = (status: number) =>
  status === 413 ? 'This file is larger than the upload limit. Compress it or scan it at a lower resolution, then upload again.'
  : status === 401 ? 'Your session has ended. Sign in again, then upload.'
  : status === 403 ? 'Only students can upload documents.'
  : status >= 500 ? 'The server could not process the upload. Try again in a moment; if it keeps failing, contact the scholarship office.'
  : `The upload was not accepted (error ${status}).`;

function Upload({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [declaredType, setDeclaredType] = useState('');
  const docTypes = useDocTypes();

  const policy = useApi<{ maxBytes: number; accept: string[] }>('/documents/upload-policy');

  const send = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    // The same limits the server enforces, checked first so a large file is not sent for nothing.
    if (policy.data && file.size > policy.data.maxBytes) {
      setError(`"${file.name}" is ${megabytes(file.size)}. The limit is ${megabytes(policy.data.maxBytes)}. Compress it or scan it at a lower resolution, then upload again.`);
      if (input.current) input.current.value = '';
      return;
    }
    if (policy.data && file.type && !policy.data.accept.includes(file.type)) {
      setError(`"${file.name}" is not a PDF, PNG or JPEG file. Save or scan the document in one of those formats and upload again.`);
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    if (declaredType) form.append('declaredType', declaredType);
    try {
      const res = await fetch('/api/v1/documents', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code, body?.error?.message ?? uploadFailure(res.status));
      }
      onDone();
    } catch (e) {
      // fetch itself throws only when the request never completed (connection lost, server unreachable).
      setError(e instanceof ApiError ? e.message : 'The upload could not reach the server. Check your connection and try again.');
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
      <div>
        <strong>Upload a marksheet, income certificate or identity document</strong>
        <span className="small muted">Drag a file here or choose one. PDF, PNG or JPEG, up to {policy.data ? `${Math.round(policy.data.maxBytes / 1024 / 1024)} MB` : '10 MB'}. Files are scanned and stored encrypted.</span>
      </div>
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => send(e.target.files?.[0])} aria-label="Choose document" />
      <div className="row">
        <select className="select" style={{ width: 240 }} value={declaredType} onChange={(e) => setDeclaredType(e.target.value)} aria-label="Document type">
          <option value="">Detect type automatically</option>
          {docTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : 'Choose file'}
        </button>
      </div>
      {error && <div style={{ flexBasis: '100%' }}><ErrorText error={error} /></div>}
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
                    <td><StatusPill status={d.status} />{d.rejection && <div className="small" style={{ color: 'var(--danger)', marginTop: 4, maxWidth: 260 }}>{d.rejection.reason}</div>}</td>
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
