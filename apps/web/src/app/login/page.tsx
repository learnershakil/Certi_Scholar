'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { post } from '@/lib/api';
import { HOME } from '@/components/AppShell';
import { ErrorText } from '@/components/ui';
import type { Me } from '@/lib/types';

const DEMO = ['student', 'verifier', 'officer', 'admin'];

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const me = await post<Me>('/auth/login', { email, password });
      router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : HOME[me.role]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="card-body">
          <div className="brand" style={{ color: 'var(--text)', padding: '0 0 16px' }}>
            <span className="brand-mark">CS</span> CertiScholar
          </div>
          <h1 style={{ marginBottom: 4 }}>Sign in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Scholarship document processing</p>
          <form onSubmit={submit}>
            <div className="form-row">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <ErrorText error={error} />
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {process.env.NODE_ENV !== 'production' && (
            <div className="demo-accounts muted" style={{ marginTop: 16 }}>
              Demo accounts (non-production seed):{' '}
              {DEMO.map((d, i) => (
                <span key={d}>
                  {i > 0 && ' · '}
                  <button type="button" onClick={() => { setEmail(`${d}@certischolar.local`); setPassword('Demo#Pass2026'); }}>
                    {d}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
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
