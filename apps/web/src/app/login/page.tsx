'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { post } from '@/lib/api';
import { initials, roleLabel, useBranding } from '@/lib/branding';
import { HOME } from '@/components/AppShell';
import { ErrorText } from '@/components/ui';
import type { Me, Role } from '@/lib/types';

const ROLES: Role[] = ['student', 'verifier', 'scholarship_officer', 'admin'];
/**
 * Optional shortcuts for a demo environment, from NEXT_PUBLIC_DEMO_ACCOUNTS ("email:role,email:role").
 * They fill the email and role only; the password is always typed.
 */
const DEMO: Array<[string, Role]> = (process.env.NEXT_PUBLIC_DEMO_ACCOUNTS ?? '')
  .split(',')
  .map((entry) => entry.trim().split(':') as [string, Role])
  .filter(([email, role]) => email && ROLES.includes(role));

const POINT_COLOURS = ['var(--info)', 'var(--danger)', 'var(--success)'];

/** Left panel: what the product does, drawn as a document with highlighted fields and an explained result. */
function Showcase() {
  const { branding } = useBranding();
  return (
    <aside className="login-showcase">
      <div className="brand" style={{ padding: 0 }}>
        <span className="brand-mark">{initials(branding.appName)}</span> {branding.appName}
      </div>
      <div>
        {branding.eyebrow && <p className="login-eyebrow">{branding.eyebrow}</p>}
        {branding.headline && <h1 className="login-headline">{branding.headline}</h1>}
        {branding.lead && <p className="login-lead">{branding.lead}</p>}
      </div>
      <svg className="login-art" viewBox="0 0 520 300" role="img" aria-label="A marksheet with highlighted fields and a recommendation card">
        <rect x="24" y="16" width="250" height="268" rx="6" fill="#16171a" stroke="rgba(255,255,255,0.1)" />
        <rect x="48" y="40" width="150" height="8" rx="4" fill="rgba(255,255,255,0.22)" />
        <rect x="48" y="58" width="100" height="6" rx="3" fill="rgba(255,255,255,0.1)" />
        <rect x="44" y="84" width="122" height="20" rx="3" fill="rgba(91,155,248,0.12)" stroke="rgba(91,155,248,0.7)" />
        <rect x="52" y="91" width="104" height="6" rx="3" fill="rgba(255,255,255,0.35)" />
        <rect x="44" y="112" width="92" height="20" rx="3" fill="rgba(235,87,87,0.12)" stroke="rgba(235,87,87,0.8)" />
        <rect x="52" y="119" width="74" height="6" rx="3" fill="rgba(255,255,255,0.35)" />
        {[150, 172, 194, 216].map((y) => (
          <g key={y}>
            <rect x="48" y={y} width="110" height="6" rx="3" fill="rgba(255,255,255,0.12)" />
            <rect x="214" y={y - 4} width="36" height="14" rx="3" fill="rgba(91,155,248,0.1)" stroke="rgba(91,155,248,0.6)" />
          </g>
        ))}
        <rect x="48" y="246" width="70" height="6" rx="3" fill="rgba(255,255,255,0.12)" />
        <rect x="196" y="240" width="58" height="18" rx="3" fill="rgba(242,201,76,0.12)" stroke="rgba(242,201,76,0.8)" />
        <rect x="292" y="70" width="206" height="150" rx="8" fill="#141516" stroke="rgba(255,255,255,0.12)" />
        <circle cx="314" cy="96" r="4" fill="#4cb782" />
        <rect x="326" y="92" width="96" height="8" rx="4" fill="rgba(255,255,255,0.4)" />
        {[124, 148, 172, 196].map((y, i) => (
          <g key={y}>
            <circle cx="316" cy={y} r="3.5" fill={i === 3 ? '#f2c94c' : '#4cb782'} />
            <rect x="328" y={y - 3} width={i % 2 ? 120 : 146} height="6" rx="3" fill="rgba(255,255,255,0.14)" />
          </g>
        ))}
      </svg>
      <ul className="login-points">
        {(branding.points ?? []).map((point, i) => (
          <li key={point}>
            <span style={{ background: POINT_COLOURS[i % POINT_COLOURS.length] }} />
            {point}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [showPassword, setShowPassword] = useState(false);
  const { branding, roleLabels } = useBranding();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const me = await post<Me>('/auth/login', { email, password, role });
      router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : HOME[me.role]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-split">
      <Showcase />
      <main className="login-side">
        <div className="brand login-brand">
          <span className="brand-mark">{initials(branding.appName)}</span> {branding.appName}
        </div>
        <form className="login-form card" onSubmit={submit} aria-label="Sign in">
          <h1>Log in</h1>
          <div className="input-icon">
            <label className="sr-only" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <svg viewBox="0 0 16 16" aria-hidden><path d="M8 7.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM2.75 14c.6-2.75 2.6-4.25 5.25-4.25S12.65 11.25 13.25 14" /></svg>
          </div>
          <div className="input-icon">
            <label className="sr-only" htmlFor="password">Password</label>
            <input id="password" className="input" type={showPassword ? 'text' : 'password'} placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="input-icon-btn" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
                <circle cx="8" cy="8" r="2" />
                {!showPassword && <path d="M2.5 13.5l11-11" />}
              </svg>
            </button>
          </div>
          <div>
            <label className="sr-only" htmlFor="role">Sign in as</label>
            <select id="role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(roleLabels, r)}</option>
              ))}
            </select>
          </div>
          <ErrorText error={error} />
          <button className="btn btn-primary login-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {branding.passwordHelp && (
            <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
              {branding.passwordHelp}
            </p>
          )}
          {DEMO.length > 0 && (
            <div className="demo-accounts muted" style={{ textAlign: 'center' }}>
              Demo accounts:{' '}
              {DEMO.map(([email, r], i) => (
                <span key={email}>
                  {i > 0 && ' · '}
                  <button type="button" onClick={() => { setEmail(email); setRole(r); }}>
                    {email.split('@')[0]}
                  </button>
                </span>
              ))}
            </div>
          )}
        </form>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
