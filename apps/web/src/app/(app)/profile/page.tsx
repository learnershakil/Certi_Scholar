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
  name: string;
  email: string;
  role: Role;
  profile: { phone?: string; gender?: string; state?: string };
  profileComplete: boolean;
}

function Details({ data, onSaved }: { data: Profile; onSaved: () => void }) {
  const me = useMe();
  const reloadMe = useReloadMe();
  const router = useRouter();
  const { roleLabels } = useBranding();
  const student = me.role === 'student';
  // The choices are the rule engine's own allowed values, so the form and the eligibility rules always agree.
  const facts = useApi<{ facts: Record<string, FactDefinition> }>(student ? '/scholarships/facts' : null);
  const [form, setForm] = useState({ name: data.name, ...data.profile });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  // Gender and state are fixed once saved; only the ones still missing can be entered.
  const genderLocked = Boolean(data.profile.gender);
  const stateLocked = Boolean(data.profile.state);

  useEffect(() => setForm({ name: data.name, ...data.profile }), [data]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const options = (fact: string) => facts.data?.facts[fact]?.options ?? [];
  const label = (fact: string, fallback: string) => facts.data?.facts[fact]?.label ?? fallback;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      const profile: Record<string, string> = { phone: form.phone ?? '' };
      if (student && !genderLocked && form.gender) profile.gender = form.gender;
      if (student && !stateLocked && form.state?.trim()) profile.state = form.state.trim();
      await patch('/auth/me/profile', { name: form.name, profile });
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

  return (
    <form className="stack" onSubmit={save} aria-label="Profile details">
      <div className="grid grid-2">
        <Card title="Personal details">
          <div className="form-row">
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" value={form.name} onChange={set('name')} required minLength={2} />
          </div>
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
            {genderLocked && stateLocked ? (
              <Notice tone="info">These are used by scholarship rules and are fixed once set. If one is wrong, contact the scholarship office.</Notice>
            ) : (
              <Notice tone="warning">Scholarship rules use these details. <strong>Check them carefully: once saved they cannot be changed.</strong></Notice>
            )}
            <div className="form-row" style={{ marginTop: 12 }}>
              <label className="label" htmlFor="gender">{label('applicant.gender', 'Gender')}</label>
              {genderLocked ? (
                <input id="gender" className="input" value={data.profile.gender} readOnly disabled />
              ) : (
                <select id="gender" className="select" value={form.gender ?? ''} onChange={set('gender')} required>
                  <option value="" disabled>Select…</option>
                  {options('applicant.gender').map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </div>
            <div className="form-row">
              <label className="label" htmlFor="state">{label('applicant.state', 'State')}</label>
              <input id="state" className="input" value={form.state ?? ''} onChange={set('state')} readOnly={stateLocked} disabled={stateLocked} required={!stateLocked} />
            </div>
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
          <Notice tone="info"><strong>Welcome.</strong> Before you start, add your gender and state of domicile. Scholarship eligibility depends on them.</Notice>
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
