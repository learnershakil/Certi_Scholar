'use client';

import { useState } from 'react';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { roleLabel, useBranding } from '@/lib/branding';
import type { Role } from '@/lib/types';
import { Card, ErrorText, PageHead, StatusPill } from '@/components/ui';

interface User { _id: string; name: string; email: string; role: Role; active: boolean }

const ROLES: Role[] = ['student', 'verifier', 'scholarship_officer', 'admin'];

export default function UsersPage() {
  const { roleLabels } = useBranding();
  const users = useApi<User[]>('/admin/users');
  const [form, setForm] = useState({ name: '', email: '', role: 'verifier' as Role, password: '' });
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
      <PageHead title="Users & access" subtitle="Roles determine what each person can see; case assignment narrows it further." />
      <ErrorText error={error} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <Card flush title="Users">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u._id}>
                  <td>{u.name}<div className="small faint">{u.email}</div></td>
                  <td>
                    <select className="select" style={{ width: 200 }} value={u.role} onChange={(e) => run(() => patch(`/admin/users/${u._id}`, { role: e.target.value }))} aria-label={`Role for ${u.name}`}>
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
        </Card>
        <Card title="Add user">
          {/* This creates someone else's account: autocomplete hints stop the browser filling in the admin's own sign-in. */}
          <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run(async () => { await post('/admin/users', form); setForm({ name: '', email: '', role: 'verifier', password: '' }); }); }}>
            <div className="form-row">
              <label className="label" htmlFor="new-user-name">Full name</label>
              <input id="new-user-name" name="new-user-name" className="input" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="new-user-email">Email</label>
              <input id="new-user-email" name="new-user-email" className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="new-user-role">Role</label>
              <select id="new-user-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(roleLabels, r)}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="new-user-password">Initial password</label>
              <input id="new-user-password" name="new-user-password" className="input" type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <div className="small faint" style={{ marginTop: 4 }}>At least 10 characters. Share it with the person securely; they can change it under Profile &amp; password.</div>
            </div>
            <button type="submit" className="btn btn-primary">Create user</button>
          </form>
        </Card>
      </div>
    </>
  );
}
