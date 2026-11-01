'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/useApi';
import { dateTime } from '@/lib/format';
import { Card, Loading, PageHead } from '@/components/ui';

interface AuditRow { _id: string; action: string; entity: string; entityId: string; actor?: { name: string }; actorRole: string; details?: unknown; ip?: string; createdAt: string }
interface AccessRow { _id: string; document?: { _id: string; originalName: string }; actor?: { name: string; role: string }; variant: string; ip?: string; createdAt: string }

export default function AuditPage() {
  const [tab, setTab] = useState<'audit' | 'access'>('audit');
  const [action, setAction] = useState('');
  const audit = useApi<AuditRow[]>(tab === 'audit' ? `/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}` : null);
  const access = useApi<AccessRow[]>(tab === 'access' ? '/admin/access-log' : null);

  return (
    <>
      <PageHead title="Audit" subtitle="Every change and every document view is recorded and cannot be edited from the application." />
      <div className="tabs">
        <button className={`tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>Actions</button>
        <button className={`tab${tab === 'access' ? ' active' : ''}`} onClick={() => setTab('access')}>Document views</button>
      </div>
      {tab === 'audit' ? (
        <Card
          flush
          title="Actions"
          actions={
            <select className="select" style={{ width: 220 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter action">
              <option value="">All actions</option>
              {['field.corrected', 'field.confirmed', 'review.completed', 'verification.manual', 'verification.requested', 'rule.published', 'settings.updated', 'application.decided', 'document.uploaded', 'document.rejected_malware', 'document.purged', 'auth.login'].map((a) => <option key={a}>{a}</option>)}
            </select>
          }
        >
          {!audit.data ? <Loading /> : (
            <table className="table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                {audit.data.map((r) => (
                  <tr key={r._id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</td>
                    <td>{r.actor?.name ?? 'System'}<div className="small faint">{r.actorRole}</div></td>
                    <td className="mono">{r.action}</td>
                    <td className="small">{r.entity === 'Document' ? <Link href={`/documents/${r.entityId}`}>{r.entity}</Link> : r.entity}<div className="faint mono">{r.entityId?.slice(-8)}</div></td>
                    <td className="small mono" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>{r.details ? JSON.stringify(r.details) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card flush title="Document views">
          {!access.data ? <Loading /> : (
            <table className="table">
              <thead><tr><th>When</th><th>Viewer</th><th>Document</th><th>Variant</th><th>IP</th></tr></thead>
              <tbody>
                {access.data.map((r) => (
                  <tr key={r._id}>
                    <td className="small muted">{dateTime(r.createdAt)}</td>
                    <td>{r.actor?.name}<div className="small faint">{r.actor?.role}</div></td>
                    <td>{r.document ? <Link href={`/documents/${r.document._id}`}>{r.document.originalName}</Link> : '—'}</td>
                    <td>{r.variant}</td>
                    <td className="mono small">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
