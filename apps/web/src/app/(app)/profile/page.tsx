'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { roleLabel, useBranding } from '@/lib/branding';
import type { FactDefinition, Role } from '@/lib/types';
import { HOME, useMe, useReloadMe } from '@/components/AppShell';
import { useRouter } from 'next/navigation';
import { Card, ErrorText, Loading, Notice, PageHead } from '@/components/ui';

interface Profile {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  profile: { phone?: string; fatherName?: string; motherName?: string; gender?: string; state?: string };
  profileComplete: boolean;
}

type DetailKey = 'name' | 'fatherName' | 'motherName' | 'gender' | 'state';
const DETAILS: Array<{ key: DetailKey; label: string; fact?: string }> = [
  { key: 'name', label: 'Full name (as on your documents)' },
  { key: 'fatherName', label: "Father's name" },
  { key: 'motherName', label: "Mother's name" },
  { key: 'gender', label: 'Gender', fact: 'applicant.gender' },
  { key: 'state', label: 'State of domicile', fact: 'applicant.state' },
];

function Details({ data, onSaved }: { data: Profile; onSaved: () => void }) {
  const me = useMe();
  const reloadMe = useReloadMe();
  const router = useRouter();
  const { roleLabels } = useBranding();
  const student = me.role === 'student';
  // The choices are the rule engine's own allowed values, so the form and the eligibility rules always agree.
  const facts = useApi<{ facts: Record<string, FactDefinition> }>(student ? '/scholarships/facts' : null);
  const initial = () => ({ name: data.name ?? '', ...data.profile });
  const [form, setForm] = useState<Record<string, string | undefined>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  const saved = (k: DetailKey) => (k === 'name' ? data.name : data.profile[k]);
  // A student's details are entered once; afterwards only the scholarship office can change them. Staff keep their name editable.
  const locked = (k: DetailKey) => student && Boolean(saved(k));
  const allLocked = student && DETAILS.every((d) => locked(d.key));

  useEffect(() => setForm(initial()), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const options = (fact: string) => facts.data?.facts[fact]?.options ?? [];
  const label = (d: (typeof DETAILS)[number]) => (d.key === 'name' && !student ? 'Full name' : (d.fact && facts.data?.facts[d.fact]?.label) || d.label);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      const profile: Record<string, string> = { phone: form.phone ?? '' };
      const body: Record<string, unknown> = { profile };
      if (!locked('name') && form.name?.trim()) body.name = form.name.trim();
      if (student) for (const d of DETAILS) if (d.key !== 'name' && !locked(d.key) && form[d.key]?.trim()) profile[d.key] = form[d.key]!.trim();
      await patch('/auth/me/profile', body);
      await reloadMe();
      onSaved();
      // Finishing the profile for the first time takes the person on to their start page.
      if (!data.profileComplete) return router.replace(HOME[me.role]);
      setMsg('Saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (d: (typeof DETAILS)[number]) => (
    <div className="form-row" key={d.key}>
      <label className="label" htmlFor={d.key}>{label(d)}</label>
      {locked(d.key) || (d.key !== 'gender') ? (
        <input id={d.key} className="input" value={form[d.key] ?? ''} onChange={set(d.key)} readOnly={locked(d.key)} disabled={locked(d.key)} required={!locked(d.key)} minLength={2} />
      ) : (
        <select id={d.key} className="select" value={form.gender ?? ''} onChange={set('gender')} required>
          <option value="" disabled>Select…</option>
          {options('applicant.gender').map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <form className="stack" onSubmit={save} aria-label="Profile details">
      <div className="grid grid-2">
        <Card title="Account">
          {!student && field(DETAILS[0])}
          <div className="form-row">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" value={data.email} readOnly disabled />
            <div className="small faint">Your email is your sign-in name; an administrator can change it.</div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="role">Role</label>
            <input id="role" className="input" value={roleLabel(roleLabels, data.role)} readOnly disabled />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" type="tel" value={form.phone ?? ''} onChange={set('phone')} placeholder="+91 98765 43210" />
          </div>
        </Card>
        {student && (
          <Card title="Applicant details">
            {allLocked ? (
              <Notice tone="info">These are matched against your documents and used by scholarship rules. Only a verification officer or administrator can change them; contact the scholarship office if one is wrong.</Notice>
            ) : (
              <Notice tone="warning"><strong>Enter these exactly as they appear on your documents.</strong> Once saved, only a verification officer or administrator can change them.</Notice>
            )}
            <div style={{ marginTop: 12 }}>{DETAILS.map(field)}</div>
          </Card>
        )}
      </div>
      <ErrorText error={error} />
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : data.profileComplete ? 'Save changes' : 'Save and continue'}</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </form>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setMsg(undefined);
    try {
      await post('/auth/me/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg('Password changed.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title="Change password">
      <form onSubmit={submit} aria-label="Change password" style={{ maxWidth: 420 }}>
        <div className="form-row">
          <label className="label" htmlFor="current">Current password</label>
          <input id="current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="new">New password</label>
          <input id="new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} required />
          <div className="small faint">At least 10 characters.</div>
        </div>
        <div className="form-row">
          <label className="label" htmlFor="confirm">Confirm new password</label>
          <input id="confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {mismatch && <div className="small" style={{ color: 'var(--danger)' }}>Passwords do not match.</div>}
        </div>
        <ErrorText error={error} />
        <div className="row">
          <button className="btn" disabled={!current || next.length < 10 || next !== confirm}>Change password</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  const profile = useApi<Profile>('/auth/me/profile');
  return (
    <>
      <PageHead title="My profile" subtitle="Your details and sign-in password." />
      {profile.data && !profile.data.profileComplete && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="info"><strong>Welcome.</strong> {profile.data.role === 'student' ? 'Before you start, add your name, your parents\' names, gender and state of domicile. Your documents are checked against them.' : 'Before you start, add your name.'}</Notice>
        </div>
      )}
      <ErrorText error={profile.error} />
      {!profile.data ? (
        <Loading />
      ) : (
        <div className="stack">
          <Details data={profile.data} onSaved={profile.reload} />
          <ChangePassword />
        </div>
      )}
    </>
  );
}
