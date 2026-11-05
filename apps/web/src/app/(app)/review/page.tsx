'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType } from '@/lib/format';
import { useMe } from '@/components/AppShell';
import { Card, Empty, ErrorText, Loading, PageHead, Stat, StatusPill } from '@/components/ui';

interface QueueItem {
  id: string;
  documentType: string | null;
  status: string;
  reason: 'field_review' | 'processing_failed' | 'verification';
  pendingFields: number;
  assignedTo: string | null;
  createdAt: string;
}

const REASON = { field_review: 'Field review', processing_failed: 'Processing failed', verification: 'Verification' };

export default function ReviewQueuePage() {
  const me = useMe();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<QueueItem[]>('/documents/review-queue', { pollMs: 10_000, pollWhile: () => true });
  const [actionError, setActionError] = useState<string>();

  const open = async (item: QueueItem) => {
    setActionError(undefined);
    try {
      if (me.role === 'verifier' && item.assignedTo !== me.id) await post(`/documents/${item.id}/claim`);
      router.push(`/documents/${item.id}`);
    } catch (e) {
      setActionError((e as Error).message);
      void reload();
    }
  };

  const mine = data?.filter((d) => d.assignedTo === me.id) ?? [];
  const unassigned = data?.filter((d) => !d.assignedTo) ?? [];

  return (
    <>
      <PageHead title="Review queue" subtitle="Fields below the confidence threshold, failed processing and pending verification. Claim a case to open its content." />
      <div className="stat-strip" style={{ marginBottom: 16 }}>
        <Stat label="Assigned to me" value={mine.length} />
        <Stat label="Unassigned" value={unassigned.length} />
        <Stat label="Fields awaiting review" value={data?.reduce((s, d) => s + d.pendingFields, 0) ?? '—'} />
      </div>
      <ErrorText error={error ?? actionError} />
      <Card flush title="Cases">
        {loading ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>Nothing is waiting for review.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Work</th>
                <th>Type</th>
                <th>Pending fields</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.id.slice(-8).toUpperCase()}</td>
                  <td><StatusPill status={d.status} label={REASON[d.reason]} /></td>
                  <td>{docType(d.documentType)}</td>
                  <td>{d.pendingFields || '—'}</td>
                  <td className="muted">{dateTime(d.createdAt)}</td>
                  <td className="right">
                    <button className="btn btn-sm btn-primary" onClick={() => open(d)}>
                      {d.assignedTo === me.id || me.role === 'admin' ? 'Open' : 'Claim & open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
