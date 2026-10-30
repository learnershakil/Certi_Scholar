'use client';

import { useApi } from '@/lib/useApi';
import { docType, humanize, pct } from '@/lib/format';
import { Card, ErrorText, Loading, PageHead, Stat } from '@/components/ui';

interface Summary {
  applicationsByStatus: Record<string, number>;
  applicationsByScholarship: Array<{ _id: string; name: string; n: number; awarded: number }>;
  documentsByStatus: Record<string, number>;
  extraction: Array<{ documentType: string; field: string; extracted: number; lowConfidence: number; corrected: number; correctionRate: number }>;
  consistencyFailureRate: number;
  verification: { authoritativeRequests: number; authoritativeMatchRate: number; simulatedResults: number };
  recommendationOutcomes: Record<string, number>;
  stageTimings: Array<{ stage: string; avgMs: number; maxMs: number; runs: number; failureRate: number }>;
  throughputByHour: Array<{ hour: string; documents: number }>;
  processedLastHour: number;
  officerThroughput: Array<{ name: string; action: string; n: number }>;
}

function Breakdown({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((s, n) => s + n, 0) || 1;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {Object.entries(data).map(([k, n]) => (
        <div key={k}>
          <div className="row-between small"><span>{humanize(k)}</span><span className="muted">{n}</span></div>
          <div className="bar"><span style={{ width: `${(n / total) * 100}%` }} /></div>
        </div>
      ))}
      {Object.keys(data).length === 0 && <span className="muted">No data</span>}
    </div>
  );
}

export default function ReportsPage() {
  const { data, error } = useApi<Summary>('/reports/summary');
  if (error) return <ErrorText error={error} />;
  if (!data) return <Loading />;
  const totalDocs = Object.values(data.documentsByStatus).reduce((s, n) => s + n, 0);
  const failed = data.documentsByStatus.failed ?? 0;

  return (
    <>
      <PageHead title="Reports" actions={<a className="btn" href="/api/v1/reports/awards.csv">Export award list (CSV)</a>} />
      <div className="stack">
        <div className="grid grid-4">
          <Stat label="Documents processed (last hour)" value={data.processedLastHour} hint="Target: 500 / hour" />
          <Stat label="Processing failure rate" value={pct(totalDocs ? failed / totalDocs : 0)} hint={`${failed} of ${totalDocs} documents`} />
          <Stat label="Consistency failure rate" value={pct(data.consistencyFailureRate)} />
          <Stat label="Authority verification match rate" value={pct(data.verification.authoritativeMatchRate)} hint={`${data.verification.authoritativeRequests} authoritative · ${data.verification.simulatedResults} simulated (excluded)`} />
        </div>
        <div className="grid grid-3">
          <Card title="Applications by status"><Breakdown data={data.applicationsByStatus} /></Card>
          <Card title="Recommendation outcomes"><Breakdown data={data.recommendationOutcomes} /></Card>
          <Card title="Documents by status"><Breakdown data={data.documentsByStatus} /></Card>
        </div>
        <div className="grid grid-2">
          <Card flush title="Applications by scholarship">
            <table className="table">
              <thead><tr><th>Scholarship</th><th className="right">Applications</th><th className="right">Awarded</th></tr></thead>
              <tbody>{data.applicationsByScholarship.map((s) => <tr key={s._id}><td>{s.name}</td><td className="right">{s.n}</td><td className="right">{s.awarded}</td></tr>)}</tbody>
            </table>
          </Card>
          <Card flush title="Processing time by stage">
            <table className="table">
              <thead><tr><th>Stage</th><th className="right">Runs</th><th className="right">Average</th><th className="right">Max</th><th className="right">Failures</th></tr></thead>
              <tbody>{data.stageTimings.map((s) => <tr key={s.stage}><td style={{ textTransform: 'capitalize' }}>{s.stage}</td><td className="right">{s.runs}</td><td className="right">{s.avgMs} ms</td><td className="right">{s.maxMs} ms</td><td className="right">{pct(s.failureRate)}</td></tr>)}</tbody>
            </table>
          </Card>
        </div>
        <Card flush title="Extraction accuracy proxy: correction rate by field" actions={<span className="small muted">High correction rates indicate an extraction profile to improve</span>}>
          <table className="table">
            <thead><tr><th>Document type</th><th>Field</th><th className="right">Extracted</th><th className="right">Below threshold</th><th className="right">Corrected</th><th className="right">Correction rate</th></tr></thead>
            <tbody>
              {data.extraction.map((e) => (
                <tr key={`${e.documentType}-${e.field}`}>
                  <td>{docType(e.documentType)}</td>
                  <td className="mono">{e.field}</td>
                  <td className="right">{e.extracted}</td>
                  <td className="right">{e.lowConfidence}</td>
                  <td className="right">{e.corrected}</td>
                  <td className="right">{pct(e.correctionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card flush title="Officer throughput (30 days)">
          <table className="table">
            <thead><tr><th>Officer</th><th>Action</th><th className="right">Count</th></tr></thead>
            <tbody>{data.officerThroughput.map((o, i) => <tr key={i}><td>{o.name}</td><td className="mono">{o.action}</td><td className="right">{o.n}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
