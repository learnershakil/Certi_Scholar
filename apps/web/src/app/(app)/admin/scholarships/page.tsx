'use client';

import { useEffect, useState } from 'react';
import { post, put } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTime, docType, inr } from '@/lib/format';
import type { FactDefinition, NodeResult, RuleNode, Scholarship } from '@/lib/types';
import { RuleBuilder } from '@/components/RuleBuilder';
import { useDocTypes } from '@/components/AppShell';
import { EvaluationTree } from '@/components/Progress';
import { Card, ErrorText, Loading, Notice, PageHead, StatusPill } from '@/components/ui';

interface RuleVersion {
  _id: string;
  version: number;
  active: boolean;
  root: RuleNode;
  changeNote?: string;
  createdBy?: { name: string };
  createdAt: string;
}

function TestHarness({ rule, facts }: { rule: RuleNode; facts: Record<string, FactDefinition> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<NodeResult>();
  const [error, setError] = useState<string>();

  const toFacts = () =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => [k, facts[k].type === 'number' ? Number(v) : facts[k].type === 'boolean' ? v === 'true' : v]),
    );

  return (
    <Card title="Test harness" actions={<span className="small muted">Hypothetical applicant · nothing is saved</span>}>
      <div className="grid grid-2" style={{ gap: 10 }}>
        {Object.entries(facts).map(([k, f]) => (
          <div key={k}>
            <label className="label" htmlFor={`f-${k}`}>{f.label}</label>
            {f.type === 'boolean' || f.options ? (
              <select id={`f-${k}`} className="select" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })}>
                <option value="">Not provided</option>
                {(f.options ?? ['true', 'false']).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input id={`f-${k}`} className="input" type={f.type === 'number' ? 'number' : 'text'} placeholder="Not provided" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <button
          className="btn"
          onClick={async () => {
            setError(undefined);
            try {
              setResult(await post<NodeResult>('/scholarships/rules/test', { root: rule, facts: toFacts() }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Evaluate draft rule
        </button>
      </div>
      <ErrorText error={error} />
      {result && <EvaluationTree node={result} />}
    </Card>
  );
}

function Editor({ scholarship, facts }: { scholarship: Scholarship; facts: Record<string, FactDefinition> }) {
  const versions = useApi<RuleVersion[]>(`/scholarships/${scholarship._id}/rules`);
  const [draft, setDraft] = useState<RuleNode>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<number>();
  const active = versions.data?.find((v) => v.active);

  useEffect(() => {
    if (active) setDraft(active.root);
    else if (versions.data) setDraft({ type: 'group', op: 'AND', children: [{ type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 60 }] });
  }, [active, versions.data]);

  if (!draft) return <Loading />;
  return (
    <div className="stack">
      <Card
        title={<div><h2>{scholarship.name}</h2><div className="small muted">{scholarship.code} · {inr(scholarship.amount)} · requires {scholarship.requiredDocuments.map(docType).join(', ')}</div></div>}
        actions={active && <StatusPill status="processed" label={`Live: v${active.version}`} />}
      >
        <RuleBuilder value={draft} facts={facts} onChange={setDraft} />
        <div className="row" style={{ marginTop: 14 }}>
          <input className="input" placeholder="Change note (required)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Change note" />
          <button
            className="btn btn-primary"
            disabled={note.trim().length < 3}
            onClick={async () => {
              setError(undefined);
              try {
                const r = await put<RuleVersion>(`/scholarships/${scholarship._id}/rules`, { root: draft, changeNote: note });
                setSaved(r.version);
                setNote('');
                void versions.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Publish new version
          </button>
        </div>
        {saved && <div style={{ marginTop: 10 }}><Notice tone="success">Version {saved} is live. New evaluations use it immediately; past recommendations keep the version they were made with.</Notice></div>}
        <ErrorText error={error} />
      </Card>
      <TestHarness rule={draft} facts={facts} />
      <Card flush title="Version history">
        <table className="table">
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v._id}>
                <td style={{ width: 70 }}>v{v.version}</td>
                <td>{v.changeNote}<div className="small faint">{v.createdBy?.name ?? 'Seed'} · {dateTime(v.createdAt)}</div></td>
                <td className="right">{v.active ? <StatusPill status="processed" label="Live" /> : <button className="btn btn-sm btn-ghost" onClick={() => setDraft(v.root)}>Load into editor</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function ScholarshipsAdminPage() {
  const list = useApi<Scholarship[]>('/scholarships');
  const catalog = useApi<{ facts: Record<string, FactDefinition> }>('/scholarships/facts');
  const [selected, setSelected] = useState<string>();
  const [form, setForm] = useState({ code: '', name: '', amount: '', required: [] as string[] });
  const docTypes = useDocTypes();
  const [error, setError] = useState<string>();
  const current = list.data?.find((s) => s._id === (selected ?? list.data?.[0]?._id));

  return (
    <>
      <PageHead title="Scholarships & rules" subtitle="Eligibility rules are data. Edit, test and publish them here without a deployment." />
      <div className="grid" style={{ gridTemplateColumns: '280px minmax(0, 1fr)' }}>
        <div className="stack">
          <Card flush title="Scholarships">
            {list.data?.map((s) => (
              <button key={s._id} className={`nav-link`} style={{ all: 'unset', display: 'block', cursor: 'pointer', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: s._id === current?._id ? 'var(--primary-soft)' : undefined }} onClick={() => setSelected(s._id)}>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="small muted">{s.code}</div>
              </button>
            ))}
          </Card>
          <Card title="New scholarship">
            <div className="form-row"><input className="input" placeholder="Code, e.g. HOSTEL-26" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-label="Code" /></div>
            <div className="form-row"><input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" /></div>
            <div className="form-row"><input className="input" type="number" placeholder="Amount (INR)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Amount" /></div>
            <div className="form-row">
              <span className="label">Required documents</span>
              {docTypes.map((t) => (
                <label key={t.code} className="row small" style={{ padding: '2px 0' }}>
                  <input type="checkbox" checked={form.required.includes(t.code)} onChange={(e) => setForm({ ...form, required: e.target.checked ? [...form.required, t.code] : form.required.filter((c) => c !== t.code) })} />
                  {t.name}
                </label>
              ))}
            </div>
            <ErrorText error={error} />
            <button
              className="btn"
              onClick={async () => {
                setError(undefined);
                try {
                  const s = await post<Scholarship>('/scholarships', { code: form.code, name: form.name, amount: form.amount ? Number(form.amount) : undefined, requiredDocuments: form.required });
                  setForm({ code: '', name: '', amount: '', required: [] });
                  await list.reload();
                  setSelected(s._id);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Create
            </button>
          </Card>
        </div>
        {current && catalog.data ? <Editor key={current._id} scholarship={current} facts={catalog.data.facts} /> : <Loading />}
      </div>
    </>
  );
}
