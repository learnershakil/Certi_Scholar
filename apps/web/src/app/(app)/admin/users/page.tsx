'use client';

import { useRef, useState } from 'react';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { usePaged } from '@/lib/usePaged';
import { roleLabel, useBranding } from '@/lib/branding';
import type { Role } from '@/lib/types';
import { Card, ErrorText, Notice, PageHead, Pagination, StatusPill } from '@/components/ui';

interface User { _id: string; name?: string | null; email: string; role: Role; active: boolean }
interface ImportRow { line: number; email: string; outcome: 'ready' | 'created' | 'skipped' | 'invalid'; role?: Role; reason?: string }
interface ImportResult { dryRun: boolean; summary: Record<'ready' | 'created' | 'skipped' | 'invalid', number>; rows: ImportRow[] }

const ROLES: Role[] = ['student', 'verifier', 'scholarship_officer', 'admin'];
const TEMPLATE = 'email,password,role\nstudent.one@example.edu,Initial#Pass2026,student\nofficer.one@example.edu,Initial#Pass2026,verifier\n';
const OUTCOME_TONE = { ready: 'info', created: 'success', skipped: 'neutral', invalid: 'danger' } as const;

function AddUser({ onDone }: { onDone: () => void }) {
  const { roleLabels } = useBranding();
  const [form, setForm] = useState({ email: '', role: 'student' as Role, password: '' });
  const [error, setError] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const submit = async () => {
    setError(undefined);
    setMsg(undefined);
    try {
      await post('/admin/users', form);
      setMsg(`Account created for ${form.email}. They add their name when they first sign in.`);
      setForm({ email: '', role: form.role, password: '' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card title="Add user">
      {/* This creates someone else's account: autocomplete hints stop the browser filling in the admin's own sign-in. */}
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="form-row">
          <label className="label" htmlFor="new-user-email">Email</label>
          <input id="new-user-email" name="new-user-email" className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="new-user-password">Initial password</label>
          <input id="new-user-password" name="new-user-password" className="input" type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <div className="small faint" style={{ marginTop: 4 }}>At least 10 characters. Share it securely; they can change it under Profile &amp; password.</div>
        </div>
        <div className="form-row">
          <label className="label" htmlFor="new-user-role">Role</label>
          <select id="new-user-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(roleLabels, r)}</option>)}
          </select>
        </div>
        <ErrorText error={error} />
        {msg && <div className="small muted" style={{ marginBottom: 8 }}>{msg}</div>}
        <button type="submit" className="btn btn-primary">Create user</button>
      </form>
    </Card>
  );
}

/** CSV with email, password and optional role. A preview validates every row first; nothing is created until Import. */
function ImportUsers({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<{ name: string; text: string }>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async (dryRun: boolean, text = csv?.text) => {
    if (!text) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await post<ImportResult>('/admin/users/import', { csv: text, dryRun }));
      if (!dryRun) onDone();
    } catch (e) {
      setError((e as Error).message);
      setResult(undefined);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setCsv({ name: file.name, text });
    if (input.current) input.current.value = '';
    await send(true, text);
  };

  const ready = result?.dryRun ? result.summary.ready : 0;
  return (
    <Card title="Import users from CSV">
      <p className="small muted" style={{ marginTop: 0 }}>
        One account per row with the columns <code>email</code>, <code>password</code> and optionally <code>role</code> (student, verifier, scholarship_officer or admin; student if empty). Existing emails are skipped.{' '}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="users-template.csv">Download a template</a>
      </p>
      <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => void choose(e.target.files?.[0])} />
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{csv ? 'Choose another file' : 'Choose CSV file'}</button>
        {csv && <span className="small muted">{csv.name}</span>}
      </div>
      <ErrorText error={error} />
      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8 }} role="status">
            {result.dryRun
              ? `Preview: ${result.summary.ready} ready to create, ${result.summary.skipped} already exist, ${result.summary.invalid} with problems.`
              : `Imported: ${result.summary.created} created, ${result.summary.skipped} skipped, ${result.summary.invalid} with problems.`}
          </div>
          <div className="check-list" style={{ maxHeight: 220 }}>
            {result.rows.map((r) => (
              <div key={r.line} className="row-between small" style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
                <span><span className="faint">Row {r.line} · </span>{r.email || <em className="faint">no email</em>}{r.reason && <span className="faint"> · {r.reason}</span>}</span>
                <StatusPill status={r.outcome} tone={OUTCOME_TONE[r.outcome]} label={r.outcome === 'ready' ? 'Ready' : r.outcome === 'created' ? 'Created' : r.outcome === 'skipped' ? 'Skipped' : 'Problem'} />
              </div>
            ))}
          </div>
          {result.dryRun && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={busy || !ready} onClick={() => void send(false)}>{busy ? 'Importing…' : `Create ${ready} account${ready === 1 ? '' : 's'}`}</button>
              {result.summary.invalid > 0 && <span className="small muted">Rows with problems are left out; fix them and import the file again.</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function UsersPage() {
  const { roleLabels } = useBranding();
  const users = usePaged<User>('/admin/users');
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      void users.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHead title="Users & access" subtitle="Create accounts with an email and an initial password; people add their own name at first sign-in." />
      <ErrorText error={error} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
        <Card flush title="Users">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u._id}>
                    <td>{u.name || <span className="faint">Not signed in yet</span>}<div className="small faint">{u.email}</div></td>
                    <td>
                      <select className="select" style={{ width: 200 }} value={u.role} onChange={(e) => run(() => patch(`/admin/users/${u._id}`, { role: e.target.value }))} aria-label={`Role for ${u.name || u.email}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{roleLabel(roleLabels, r)}</option>)}
                      </select>
                    </td>
                    <td><StatusPill status={u.active ? 'pass' : 'not_applicable'} label={u.active ? 'Active' : 'Disabled'} /></td>
                    <td className="right">
                      <button className="btn btn-sm" onClick={() => run(() => patch(`/admin/users/${u._id}`, { active: !u.active }))}>{u.active ? 'Disable' : 'Enable'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={users.page} pageSize={users.pageSize} total={users.total} setPage={users.setPage} noun="users" />
        </Card>
        <div className="stack">
          <AddUser onDone={() => void users.reload()} />
          <ImportUsers onDone={() => void users.reload()} />
          <Notice tone="info">Student details (name, parents&apos; names, gender, state) are corrected under <a href="/students">Students</a>.</Notice>
        </div>
      </div>
    </>
  );
}
