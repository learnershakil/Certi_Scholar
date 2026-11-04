'use client';

import { useEffect, useState } from 'react';
import { put } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { docType } from '@/lib/format';
import { roleLabel, type Branding } from '@/lib/branding';
import { Card, ErrorText, Loading, Notice, PageHead, StatusPill } from '@/components/ui';

interface Settings {
  defaultConfidenceThreshold: number;
  classificationThreshold: number;
  percentageTolerance: number;
  retentionDays: number;
  classificationMargin: number;
  unreadableLineConfidence: number;
  certificateValidityDays: number;
  minPlausibleAge: number;
  maxPlausibleAge: number;
  verificationProvider: 'simulated' | 'registry' | 'manual_only';
  registryBaseUrl?: string;
  environment: string;
  simulatedProviderAllowed: boolean;
  branding?: Branding;
  roleLabels?: Record<string, string>;
  factText?: Record<string, { label?: string; description?: string }>;
}

const ROLE_KEYS = ['student', 'verifier', 'scholarship_officer', 'admin'];

/** Product name, sign-in page wording, role names and rule-fact labels. Saved with the other settings. */
function WordingEditor({ form, setForm }: { form: Settings; setForm: (s: Settings) => void }) {
  const b = form.branding ?? {};
  const setB = (patch: Partial<Branding>) => setForm({ ...form, branding: { ...b, ...patch } });
  const text = (key: keyof Branding, label: string, multiline = false) => (
    <div className="form-row">
      <label className="label">{label}</label>
      {multiline ? (
        <textarea className="textarea" value={(b[key] as string) ?? ''} onChange={(e) => setB({ [key]: e.target.value })} aria-label={label} />
      ) : (
        <input className="input" value={(b[key] as string) ?? ''} onChange={(e) => setB({ [key]: e.target.value })} aria-label={label} />
      )}
    </div>
  );
  return (
    <div className="grid grid-2">
      <Card title="Branding and sign-in page">
        {text('appName', 'Application name')}
        {text('eyebrow', 'Sign-in page eyebrow')}
        {text('headline', 'Sign-in page headline')}
        {text('lead', 'Sign-in page introduction', true)}
        <div className="form-row">
          <label className="label">Sign-in page points (one per line)</label>
          <textarea className="textarea" value={(b.points ?? []).join('\n')} onChange={(e) => setB({ points: e.target.value.split('\n') })} aria-label="Sign-in page points" />
        </div>
        {text('passwordHelp', 'Forgotten-password note')}
        {text('footnote', 'Sidebar note')}
      </Card>
      <div className="stack">
        <Card title="Role names">
          {ROLE_KEYS.map((r) => (
            <div className="form-row" key={r}>
              <label className="label">{r}</label>
              <input className="input" value={form.roleLabels?.[r] ?? ''} placeholder={roleLabel({}, r)} onChange={(e) => setForm({ ...form, roleLabels: { ...form.roleLabels, [r]: e.target.value } })} aria-label={`Name for ${r}`} />
            </div>
          ))}
        </Card>
        <Card flush title="Rule fact labels">
          <table className="table">
            <thead><tr><th>Fact</th><th>Label</th><th>Description</th></tr></thead>
            <tbody>
              {Object.entries(form.factText ?? {}).map(([key, t]) => (
                <tr key={key}>
                  <td className="mono small">{key}</td>
                  <td><input className="input" value={t.label ?? ''} onChange={(e) => setForm({ ...form, factText: { ...form.factText, [key]: { ...t, label: e.target.value } } })} aria-label={`Label for ${key}`} /></td>
                  <td><input className="input" value={t.description ?? ''} onChange={(e) => setForm({ ...form, factText: { ...form.factText, [key]: { ...t, description: e.target.value } } })} aria-label={`Description for ${key}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
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
            <div className="form-row">
              <label className="label">Classification margin</label>
              <input className="input" type="number" step="0.01" min="0" max="0.5" value={form.classificationMargin} onChange={num('classificationMargin')} />
              <div className="small faint">The best type must lead the next by this much, or an officer decides.</div>
            </div>
            <div className="form-row">
              <label className="label">Unreadable table line below confidence</label>
              <input className="input" type="number" step="0.05" min="0" max="1" value={form.unreadableLineConfidence} onChange={num('unreadableLineConfidence')} />
              <div className="small faint">Such a line in a marks table becomes an empty row for the officer to fill.</div>
            </div>
            <div className="form-row">
              <label className="label">Income certificate valid for (days)</label>
              <input className="input" type="number" min="1" max="3650" value={form.certificateValidityDays} onChange={num('certificateValidityDays')} />
            </div>
            <div className="form-row row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="label">Plausible age from</label>
                <input className="input" type="number" min="0" max="120" value={form.minPlausibleAge} onChange={num('minPlausibleAge')} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">to</label>
                <input className="input" type="number" min="1" max="150" value={form.maxPlausibleAge} onChange={num('maxPlausibleAge')} />
              </div>
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
        <h2 style={{ marginTop: 8 }}>Wording</h2>
        <WordingEditor form={form} setForm={setForm} />
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={async () => {
              setError(undefined);
              setMsg(undefined);
              try {
                const { environment: _e, simulatedProviderAllowed: _s, ...body } = form;
                const branding = body.branding && { ...body.branding, points: (body.branding.points ?? []).map((p) => p.trim()).filter(Boolean) };
                await put('/admin/settings', { ...body, branding, registryBaseUrl: body.registryBaseUrl || undefined });
                setMsg('Settings saved. New wording shows on the next page load.');
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
