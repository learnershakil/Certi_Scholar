// Minimal API client for scripts: cookie session, JSON helpers, polling.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

const DEMO_USERS = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'apps', 'api', 'seed', 'demo-users.json'), 'utf8'));
/** Demo account email by its short name (before the @), from apps/api/seed/demo-users.json. */
export function demoEmail(who) {
  const user = DEMO_USERS.find((u) => u.email.split('@')[0] === who);
  if (!user) throw new Error(`No demo user "${who}" in apps/api/seed/demo-users.json`);
  return user.email;
}

/** Demo password: DEMO_PASSWORD if set, else SEED_DEMO_PASSWORD from the project's .env. */
function demoPassword() {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  const envFile = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.env');
  const line = existsSync(envFile) && readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SEED_DEMO_PASSWORD='));
  const value = line && line.slice('SEED_DEMO_PASSWORD='.length).split(/\s+#/)[0].trim();
  if (!value) throw new Error('Set DEMO_PASSWORD, or SEED_DEMO_PASSWORD in .env (node scripts/init-env.mjs creates it)');
  return value;
}
export const PASSWORD = demoPassword();

export async function session(user) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: demoEmail(user), password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${user}: ${res.status}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body) => {
    const isForm = body instanceof FormData;
    const r = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { cookie, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await r.text();
    const data = r.headers.get('content-type')?.includes('json') ? JSON.parse(text || 'null') : text;
    if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`), { status: r.status, data });
    return data;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    upload: async (file) => {
      const form = new FormData();
      const mime = file.endsWith('.pdf') ? 'application/pdf' : 'image/png';
      form.append('file', new Blob([await readFile(file)], { type: mime }), basename(file));
      return call('POST', '/documents', form);
    },
  };
}

export async function waitFor(fn, { timeoutMs = 120_000, everyMs = 500 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const settled = (s) => !['queued', 'processing'].includes(s.status);

let failures = 0;
export function check(cond, msg) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
}
export const failed = () => failures;
