'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, patch, post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType, humanize, pct } from '@/lib/format';
import type { DocumentDetail, ExtractedField, TimelineEntry } from '@/lib/types';
import { useDocTypes, useMe } from '@/components/AppShell';
import { DocumentViewer } from '@/components/DocumentViewer';
import { FieldList } from '@/components/FieldList';
import { StageTracker, Timeline } from '@/components/Progress';
import { Card, ErrorText, Loading, Modal, Notice, PageHead, StatusPill } from '@/components/ui';

const ACTIVE = ['queued', 'processing'];

/** Fetches a short-lived signed URL for the preview and renews it before it expires. Undefined while loading, null if none. */
function usePreviewUrl(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>();
  useEffect(() => {
    if (!enabled) return setUrl(null);
    let timer: ReturnType<typeof setTimeout>;
    const fetchUrl = async () => {
      try {
        const r = await post<{ url: string; expiresAt: string }>(`/documents/${id}/access-url`, { variant: 'preview' });
        setUrl(r.url);
        timer = setTimeout(fetchUrl, Math.max(10_000, new Date(r.expiresAt).getTime() - Date.now() - 15_000));
      } catch {
        setUrl(null);
      }
    };
    void fetchUrl();
    return () => clearTimeout(timer);
  }, [id, enabled]);
  return url;
}

function VerificationPanel({ doc, canRequest, canManual, onChange }: { doc: DocumentDetail; canRequest: boolean; canManual: boolean; onChange: () => void }) {
  const [outcome, setOutcome] = useState<'match' | 'mismatch'>('match');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      setNote('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = doc.documentType && ['processed', 'needs_review'].includes(doc.status);

  return (
    <Card
      title="Verification against issuing authority"
      actions={canRequest && ready ? <button className="btn btn-sm" disabled={busy || doc.verification.status === 'pending'} onClick={() => act(() => post(`/documents/${doc.id}/verify`))}>Request verification</button> : undefined}
    >
      <div className="stack" style={{ gap: 12 }}>
        <ErrorText error={error} />
        {doc.verificationResults.length === 0 && <div className="muted">No verification has been performed.</div>}
        {doc.verificationResults.map((r) => (
          <div key={r._id} className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row">
                <StatusPill status={r.outcome === 'match' ? 'pass' : 'fail'} label={humanize(r.outcome)} />
                {r.simulated ? <span className="simulated-tag">SIMULATED — NOT AUTHORITATIVE</span> : <span className="small muted">Authoritative</span>}
              </div>
              <div className="small" style={{ marginTop: 4 }}>{r.providerLabel}{r.reference ? ` · ref ${r.reference}` : ''}</div>
              {r.note && <div className="small muted">{r.note}</div>}
            </div>
            <span className="small faint">{dateTime(r.createdAt)}</span>
          </div>
        ))}
        {canManual && ready && (
          <form
            className="stack"
            style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => post(`/documents/${doc.id}/verify/manual`, { outcome, note }));
            }}
          >
            <div className="small muted">Record the result of contacting the issuing authority directly (the fallback for every provider).</div>
            <div className="row">
              <select className="select" style={{ width: 200 }} value={outcome} onChange={(e) => setOutcome(e.target.value as 'match' | 'mismatch')} aria-label="Manual outcome">
                <option value="match">Authority confirmed</option>
                <option value="mismatch">Authority reported mismatch</option>
              </select>
              <input className="input" placeholder="Evidence: who was contacted, reference number" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Verification evidence" />
              <button className="btn" disabled={busy || note.trim().length < 10}>Record</button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

const REJECT_REASONS = [
  'This is not the document requested (wrong type of document).',
  'The document is unreadable or incomplete.',
  'The document does not belong to the applicant.',
];

/** Asks for the reason the student will see before rejecting a document. */
function RejectDialog({ name, onClose, onReject }: { name: string; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onReject(reason.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Reject document"
      subtitle={name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy ? 'Rejecting…' : 'Reject document'}</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>The student is notified with this reason and asked to upload the correct document. A rejected document no longer counts towards any application.</p>
      <div className="form-row">
        <label className="label" htmlFor="reject-common">Common reason</label>
        <select id="reject-common" className="select" value={REJECT_REASONS.includes(reason) ? reason : ''} onChange={(e) => setReason(e.target.value)}>
          <option value="">Write my own</option>
          {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <label className="label" htmlFor="reject-reason">Reason shown to the student</label>
      <textarea id="reject-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <ErrorText error={error} />
    </Modal>
  );
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const doc = useApi<DocumentDetail>(`/documents/${id}`, { pollMs: 2000, pollWhile: (d) => ACTIVE.includes(d.status) || d.verification.status === 'pending' });
  const accessible = Boolean(doc.data);
  const fields = useApi<ExtractedField[]>(accessible ? `/documents/${id}/fields` : null);
  const timeline = useApi<TimelineEntry[]>(accessible ? `/documents/${id}/timeline` : null);
  const preview = usePreviewUrl(id, accessible && doc.data!.status !== 'purged');
  const [rejecting, setRejecting] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [newType, setNewType] = useState<string>();
  const docTypes = useDocTypes();

  const status = doc.data?.status;
  const refreshAll = useCallback(() => {
    void doc.reload();
    void fields.reload();
    void timeline.reload();
  }, [doc, fields, timeline]);

  useEffect(() => {
    if (status && !ACTIVE.includes(status)) {
      void fields.reload();
      void timeline.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when processing settles
  }, [status]);

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await fn();
      refreshAll();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  if (doc.error instanceof ApiError && doc.error.status === 403) {
    return (
      <>
        <PageHead title="Document" />
        <Notice tone="warning">
          <div className="row-between">
            <span>This document is not assigned to you. Claim it from the review queue to open it.</span>
            {me.role === 'verifier' && <button className="btn btn-sm" onClick={() => run(() => post(`/documents/${id}/claim`))}>Claim case</button>}
          </div>
        </Notice>
        <ErrorText error={actionError} />
      </>
    );
  }
  if (doc.error) return <ErrorText error={doc.error} />;
  if (!doc.data) return <Loading />;

  const d = doc.data;
  const staff = me.role === 'verifier' || me.role === 'admin';
  const editable = staff && (me.role === 'admin' || d.assignedTo === me.id) && !['purged', 'rejected'].includes(d.status);
  const pending = fields.data?.filter((f) => f.status === 'needs_review').length ?? 0;
  const chosenType = newType ?? d.documentType ?? docTypes[0]?.code ?? '';

  return (
    <>
      <PageHead
        title={d.originalName}
        subtitle={
          <span className="row">
            {docType(d.documentType)}
            {d.classification?.confidence !== undefined && (
              <span className="faint">
                · {d.classification.source === 'officer' ? 'type set by officer' : d.classification.source === 'declared' ? 'type declared by student' : `classification ${pct(d.classification.confidence)}`}
                {d.profileFormat ? ` · ${d.profileFormat} format` : ''}
              </span>
            )}
            <StatusPill status={d.status} />
          </span>
        }
        actions={
          editable && (
            <>
              {!ACTIVE.includes(d.status) && (
                <>
                  <select className="select" style={{ width: 200 }} value={chosenType} onChange={(e) => setNewType(e.target.value)} aria-label="Change document type">
                    {docTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                  </select>
                  <button className="btn" disabled={chosenType === d.documentType} onClick={() => run(() => post(`/documents/${id}/type`, { documentType: chosenType, reason: 'Set by officer after visual inspection' }))}>
                    Change type
                  </button>
                </>
              )}
              <button className="btn" onClick={() => run(() => post(`/documents/${id}/reprocess`, { from: d.status === 'failed' ? 'ocr' : 'analyse' }))}>
                {d.status === 'failed' ? 'Retry processing' : 'Reprocess'}
              </button>
              <button className="btn btn-danger" onClick={() => setRejecting(true)}>Reject</button>
              {d.status === 'needs_review' && (
                <button className="btn btn-primary" disabled={pending > 0 || !d.documentType} onClick={() => run(() => post(`/documents/${id}/review/complete`))}>
                  Complete review{pending ? ` (${pending} pending)` : ''}
                </button>
              )}
            </>
          )
        }
      />
      {rejecting && (
        <RejectDialog
          name={d.originalName}
          onClose={() => setRejecting(false)}
          onReject={async (reason) => {
            await post(`/documents/${id}/reject`, { reason });
            setRejecting(false);
            await refreshAll();
          }}
        />
      )}
      <div className="stack">
        <ErrorText error={actionError} />
        {d.status === 'rejected' && d.rejection && (
          <Notice tone="danger">
            <strong>Rejected {dateTime(d.rejection.at)}. </strong>
            {d.rejection.reason}
            {me.role === 'student' && <> Upload the correct document on <Link href="/documents">My documents</Link>.</>}
          </Notice>
        )}
        <Notice tone={d.authenticity.established ? 'success' : 'warning'}>
          <strong>{d.authenticity.established ? 'Authenticity confirmed. ' : 'Authenticity not established. '}</strong>
          {d.authenticity.text}
          {d.verification.simulated && <span className="simulated-tag" style={{ marginLeft: 8 }}>SIMULATED PROVIDER</span>}
        </Notice>

        <Card flush>
          <StageTracker stages={d.stages} />
        </Card>

        {d.status === 'failed' && <Notice tone="danger">Processing failed. The stored file is intact and processing can be retried.</Notice>}

        {editable && !d.documentType && !ACTIVE.includes(d.status) && (
          <Notice tone="warning">
            <div className="row-between">
              <span>The document type could not be determined with confidence. Set it to continue extraction.</span>
              <div className="row">
                <select className="select" value={chosenType} onChange={(e) => setNewType(e.target.value)} aria-label="Document type">
                  {docTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select>
                <button className="btn btn-sm" onClick={() => run(() => post(`/documents/${id}/type`, { documentType: chosenType, reason: 'Set by officer after visual inspection' }))}>
                  Set type
                </button>
              </div>
            </div>
          </Notice>
        )}

        <div className="review-layout">
          <DocumentViewer src={preview} fields={fields.data ?? []} activeKey={active} onSelect={setActive} />
          <div className="stack">
            <Card
              flush
              title="Extracted fields"
              actions={pending > 0 ? <StatusPill status="needs_review" label={`${pending} need review`} /> : undefined}
            >
              {ACTIVE.includes(d.status) ? (
                <div className="empty">Processing…</div>
              ) : fields.data?.length ? (
                <FieldList
                  fields={fields.data}
                  activeKey={active}
                  onSelect={setActive}
                  editable={editable}
                  onCorrect={async (key, value, reason) => {
                    await patch(`/documents/${id}/fields/${encodeURIComponent(key)}`, { value, reason });
                    refreshAll();
                  }}
                  onConfirm={async (key) => {
                    await post(`/documents/${id}/fields/${encodeURIComponent(key)}/confirm`);
                    refreshAll();
                  }}
                />
              ) : (
                <div className="empty">No fields extracted.</div>
              )}
            </Card>
            <Card flush title="Consistency checks">
              {d.consistencyChecks.length === 0 ? (
                <div className="empty">No checks for this document.</div>
              ) : (
                <table className="table">
                  <tbody>
                    {d.consistencyChecks.map((c) => (
                      <tr key={c._id}>
                        <td style={{ width: 120 }}><StatusPill status={c.status} /></td>
                        <td>
                          <div>{c.label}</div>
                          <div className="small muted">{c.message}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="small faint" style={{ padding: '8px 12px' }}>Consistency means the document agrees with itself. It does not establish that it is genuine.</div>
            </Card>
          </div>
        </div>

        <div className="grid grid-2">
          <VerificationPanel doc={d} canRequest={me.role !== 'student' && (me.role !== 'verifier' || editable)} canManual={editable} onChange={refreshAll} />
          <Card title="Processing timeline">
            <Timeline entries={timeline.data ?? []} />
          </Card>
        </div>
      </div>
    </>
  );
}
