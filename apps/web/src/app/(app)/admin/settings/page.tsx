'use client';

import { useEffect, useState } from 'react';
import { put } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { docType } from '@/lib/format';
import { Card, ErrorText, Loading, Notice, PageHead, StatusPill } from '@/components/ui';

interface Settings {
  defaultConfidenceThreshold: number;
  classificationThreshold: number;
  percentageTolerance: number;
  retentionDays: number;
  verificationProvider: 'simulated' | 'registry' | 'manual_only';
  registryBaseUrl?: string;
  environment: string;
  simulatedProviderAllowed: boolean;
}

interface ProfileField { key: string; label: string; kind: string; pattern: string; required: boolean; threshold?: number | null }
interface Profile { _id: string; documentType: string; format: string; name?: string; version: number; fields: ProfileField[]; table?: { key: string; label: string; rowPattern: string; columns: Array<{ key: string; kind: string }> } }

function ProfileEditor({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [fields, setFields] = useState(profile.fields);
  const [error, setError] = useState<string>();
  const set = (i: number, patch: Partial<ProfileField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Card flush title={`${profile.name ?? docType(profile.documentType)} — ${profile.format} v${profile.version}`}>
      <table className="table">
        <thead>
          <tr><th>Field</th><th>Pattern (one capture group)</th><th style={{ width: 110 }}>Threshold</th><th style={{ width: 80 }}>Required</th></tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.key}>
              <td>{f.label}<div className="small faint mono">{f.key} · {f.kind}</div></td>
              <td><input className="input mono" value={f.pattern} onChange={(e) => set(i, { pattern: e.target.value })} aria-label={`${f.label} pattern`} /></td>
              <td><input className="input" type="number" step="0.01" min="0.5" max="1" placeholder="Default" value={f.threshold ?? ''} onChange={(e) => set(i, { threshold: e.target.value === '' ? null : Number(e.target.value) })} aria-label={`${f.label} threshold`} /></td>
              <td><input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} aria-label={`${f.label} required`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {profile.table && <div className="small muted" style={{ padding: '8px 12px' }}>Table rows: <code>{profile.table.rowPattern}</code></div>}
      <div className="row" style={{ padding: 12 }}>
        <button
          className="btn"
          onClick={async () => {
            setError(undefined);
            try {
              await put(`/admin/profiles/${profile.documentType}/${profile.format}`, { fields, table: profile.table ?? null });
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Publish profile v{profile.version + 1}
        </button>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const settings = useApi<Settings>('/admin/settings');
  const profiles = useApi<Profile[]>('/admin/profiles');
  const health = useApi<{ ocr: { ok: boolean; provider?: string; providers?: string[] } }>('/admin/health');
  const [form, setForm] = useState<Settings>();
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => setForm(settings.data), [settings.data]);
  if (!form) return <Loading />;

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <>
      <PageHead title="Settings & extraction profiles" subtitle={<span>Environment: <strong>{form.environment}</strong></span>} />
      <div className="stack">
        <div className="grid grid-2">
          <Card title="Confidence and consistency">
            <div className="form-row">
              <label className="label">Default field confidence threshold</label>
              <input className="input" type="number" step="0.01" min="0.5" max="1" value={form.defaultConfidenceThreshold} onChange={num('defaultConfidenceThreshold')} />
              <div className="small faint">Fields below this go to human review. Per-field overrides are set in the profile.</div>
            </div>
            <div className="form-row">
              <label className="label">Classification threshold</label>
              <input className="input" type="number" step="0.05" min="0.3" max="1" value={form.classificationThreshold} onChange={num('classificationThreshold')} />
            </div>
            <div className="form-row">
              <label className="label">Percentage tolerance (points)</label>
              <input className="input" type="number" step="0.01" min="0" max="1" value={form.percentageTolerance} onChange={num('percentageTolerance')} />
            </div>
            <div className="form-row">
              <label className="label">Retention period (days)</label>
              <input className="input" type="number" min="30" max="3650" value={form.retentionDays} onChange={num('retentionDays')} />
              <div className="small faint">Files and extracted data are deleted after this period. The audit trail is kept.</div>
            </div>
          </Card>
          <Card title="Verification provider">
            <div className="form-row">
              <label className="label">Provider</label>
              <select className="select" value={form.verificationProvider} onChange={(e) => setForm({ ...form, verificationProvider: e.target.value as Settings['verificationProvider'] })}>
                <option value="manual_only">Manual verification only</option>
                <option value="registry">Authorised registry (REST adapter)</option>
                <option value="simulated" disabled={!form.simulatedProviderAllowed}>
                  SIMULATED — demonstration only{form.simulatedProviderAllowed ? '' : ' (blocked in production)'}
                </option>
              </select>
            </div>
            {form.verificationProvider === 'registry' && (
              <div className="form-row">
                <label className="label">Registry base URL</label>
                <input className="input" value={form.registryBaseUrl ?? ''} onChange={(e) => setForm({ ...form, registryBaseUrl: e.target.value })} />
                <div className="small faint">The API key is read from the server environment (REGISTRY_API_KEY), never stored here.</div>
              </div>
            )}
            {form.verificationProvider === 'simulated' && (
              <Notice tone="warning">
                <span className="simulated-tag">SIMULATED</span> Results from this provider are labelled as simulated everywhere and never count as authenticity.
              </Notice>
            )}
            <div style={{ marginTop: 16 }}>
              <div className="label">OCR service</div>
              {health.data ? (
                <div className="row">
                  <StatusPill status={health.data.ocr.ok ? 'pass' : 'fail'} label={health.data.ocr.ok ? 'Healthy' : 'Unavailable'} />
                  <span className="small muted">{health.data.ocr.provider} {health.data.ocr.providers?.length ? `· available: ${health.data.ocr.providers.join(', ')}` : ''}</span>
                </div>
              ) : <span className="muted small">Checking…</span>}
            </div>
          </Card>
        </div>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={async () => {
              setError(undefined);
              setMsg(undefined);
              try {
                const { environment: _e, simulatedProviderAllowed: _s, ...body } = form;
                await put('/admin/settings', { ...body, registryBaseUrl: body.registryBaseUrl || undefined });
                setMsg('Settings saved.');
                void settings.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save settings
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
        <ErrorText error={error} />
        <h2 style={{ marginTop: 8 }}>Extraction profiles</h2>
        {profiles.data?.map((p) => <ProfileEditor key={p._id} profile={p} onSaved={profiles.reload} />)}
      </div>
    </>
  );
}
