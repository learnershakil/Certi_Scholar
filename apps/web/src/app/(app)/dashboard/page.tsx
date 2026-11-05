'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useApi } from '@/lib/useApi';
import { docType, inr } from '@/lib/format';
import type { Application, DocumentSummary, NodeResult, ScholarshipOverview } from '@/lib/types';
import { Card, Empty, ErrorText, Loading, Modal, PageHead, Stat, StatusPill } from '@/components/ui';

const PROFILE_FACT = /^applicant\./;

/** What a criterion means for this student now, from their profile and their processed documents. */
function standing(n: NodeResult) {
  if (n.outcome === 'pass') return { tone: 'success' as const, text: 'Met' };
  if (n.outcome === 'fail') return { tone: 'danger' as const, text: 'Not met' };
  if (n.fact && PROFILE_FACT.test(n.fact)) return { tone: 'warning' as const, text: 'Add to your profile' };
  return { tone: 'warning' as const, text: 'Awaiting documents' };
}

/** The value the check used, as the student would write it. Yes/no checks need no value; the pill says it. */
const shown = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IN') : typeof v === 'string' ? v : null);

function Criteria({ node }: { node: NodeResult }) {
  if (node.type === 'condition') {
    const s = standing(node);
    const value = shown(node.actual);
    return (
      <li className="criterion">
        <div>
          <div>{node.label.replace(/ is true$/, '')}</div>
          {value !== null && <div className="small muted">Yours: {value}</div>}
          {node.outcome === 'unknown' && !PROFILE_FACT.test(node.fact ?? '') && <div className="small faint">Not available until a matching document is processed and reviewed</div>}
        </div>
        <StatusPill status={s.tone} tone={s.tone} label={s.text} />
      </li>
    );
  }
  return (
    <li className="criterion-group">
      <div className="small muted">{node.op === 'AND' ? 'All of these' : 'At least one of these'}{node.label && !/^(All|Any) of$/.test(node.label) ? ` · ${node.label}` : ''}</div>
      <ul className="criteria">{node.children?.map((c, i) => <Criteria key={i} node={c} />)}</ul>
    </li>
  );
}

/** How many single conditions are met, not met, or still undetermined. */
function tally(n: NodeResult, t = { pass: 0, fail: 0, unknown: 0 }) {
  if (n.type === 'condition') t[n.outcome]++;
  n.children?.forEach((c) => tally(c, t));
  return t;
}

function Fit({ criteria }: { criteria: NodeResult | null }) {
  if (!criteria) return <span className="faint">Not published</span>;
  const t = tally(criteria);
  const total = t.pass + t.fail + t.unknown;
  if (criteria.outcome === 'pass') return <span style={{ color: 'var(--success)' }}>Meets all {total}</span>;
  if (criteria.outcome === 'fail') return <span style={{ color: 'var(--danger)' }}>{t.fail} of {total} not met</span>;
  return <span className="muted">{t.pass} of {total} met, {t.unknown} pending</span>;
}

const dateOnly = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

function ScholarshipDetails({ s, applied, uploaded, onClose }: { s: ScholarshipOverview; applied?: Application; uploaded: Set<string | null>; onClose: () => void }) {
  return (
    <Modal
      title={s.name}
      subtitle={s.sponsor}
      onClose={onClose}
      footer={
        applied ? (
          <Link className="btn" href={`/applications/${applied._id}`}>View my application · {applied.status.replace('_', ' ')}</Link>
        ) : (
          <Link className="btn btn-primary" href={`/applications?scholarship=${s._id}`}>Apply for this scholarship</Link>
        )
      }
    >
      <div className="detail-facts">
        <div><span className="label">Award</span><strong>{inr(s.amount)}</strong></div>
        <div><span className="label">Deadline</span><strong>{dateOnly(s.deadline) ?? 'Open'}</strong></div>
        <div><span className="label">Status</span>{applied ? <StatusPill status={applied.status} /> : <span className="muted">Not applied</span>}</div>
      </div>
      {s.description && <p className="detail-description">{s.description}</p>}

      <h3 className="detail-heading">Documents needed</h3>
      <ul className="detail-docs">
        {s.requiredDocuments.map((t) => (
          <li key={t}>
            <span>{docType(t)}</span>
            <StatusPill status={uploaded.has(t) ? 'success' : 'neutral'} tone={uploaded.has(t) ? 'success' : 'neutral'} label={uploaded.has(t) ? 'Uploaded' : 'Not uploaded yet'} />
          </li>
        ))}
      </ul>

      <h3 className="detail-heading">Eligibility criteria{s.ruleVersion ? <span className="faint small"> · rule version {s.ruleVersion}</span> : null}</h3>
      {s.criteria ? <ul className="criteria root"><Criteria node={s.criteria} /></ul> : <div className="small muted">Criteria have not been published yet.</div>}
      <p className="small faint" style={{ marginBottom: 0 }}>
        Values come from your profile and your processed documents; an officer makes the final decision. Gender and state come from <Link href="/profile">My profile</Link>.
      </p>
    </Modal>
  );
}

export default function Dashboard() {
  const overview = useApi<ScholarshipOverview[]>('/scholarships/overview');
  const docs = useApi<DocumentSummary[]>('/documents');
  const apps = useApi<Application[]>('/applications');
  const [openId, setOpenId] = useState<string>();

  const appliedTo = new Map(apps.data?.map((a) => [a.scholarship._id, a]) ?? []);
  const uploadedTypes = new Set(docs.data?.filter((d) => !['rejected', 'purged'].includes(d.status)).map((d) => d.documentType));
  const open = overview.data?.find((s) => s._id === openId);
  const close = useCallback(() => setOpenId(undefined), []);
  const count = (pred: (d: DocumentSummary) => boolean) => docs.data?.filter(pred).length ?? '—';

  return (
    <>
      <PageHead title="Dashboard" subtitle="Scholarships open to you and where your applications stand." />
      <div className="stack">
        <div className="stat-strip">
          <Stat label="Documents uploaded" value={count(() => true)} />
          <Stat label="Being reviewed" value={count((d) => ['queued', 'processing', 'needs_review'].includes(d.status))} />
          <Stat label="Applications" value={apps.data?.length ?? '—'} />
          <Stat label="Awarded" value={apps.data?.filter((a) => a.status === 'awarded').length ?? '—'} />
        </div>

        <ErrorText error={overview.error} />
        <Card flush title={`Available scholarships${overview.data ? ` (${overview.data.length})` : ''}`}>
          {overview.loading ? (
            <Loading />
          ) : !overview.data?.length ? (
            <Empty>No scholarships are open right now.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table scholarship-list">
                <thead>
                  <tr>
                    <th>Scholarship</th>
                    <th className="right">Award</th>
                    <th>Deadline</th>
                    <th>Your documents</th>
                    <th>Eligibility</th>
                    <th>Application</th>
                    <th><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.map((s) => {
                    const applied = appliedTo.get(s._id);
                    const missing = s.requiredDocuments.filter((t) => !uploadedTypes.has(t));
                    return (
                      <tr key={s._id} aria-label={s.name} onClick={() => setOpenId(s._id)}>
                        <td>
                          <strong>{s.name}</strong>
                          <span className="small faint">{s.sponsor}</span>
                        </td>
                        <td className="right amount">{inr(s.amount)}</td>
                        <td>{dateOnly(s.deadline) ?? 'Open'}</td>
                        <td title={missing.length ? `Missing: ${missing.map(docType).join(', ')}` : undefined}>
                          {missing.length ? <span className="muted">{s.requiredDocuments.length - missing.length} of {s.requiredDocuments.length} uploaded</span> : 'All uploaded'}
                        </td>
                        <td><Fit criteria={s.criteria} /></td>
                        <td>{applied ? <StatusPill status={applied.status} /> : <span className="faint">Not applied</span>}</td>
                        <td className="right">
                          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpenId(s._id); }} aria-label={`Details for ${s.name}`}>Details</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {open && <ScholarshipDetails s={open} applied={appliedTo.get(open._id)} uploaded={uploadedTypes} onClose={close} />}
    </>
  );
}
