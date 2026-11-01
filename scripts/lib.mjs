// Minimal API client for scripts: cookie session, JSON helpers, polling.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
export const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#Pass2026';

export async function session(user) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${user}@certischolar.local`, password: PASSWORD }),
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
