export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const details = body?.error?.details;
    const detailText = Array.isArray(details) ? details.map((d) => (typeof d === 'string' ? d : `${d.path}: ${d.message}`)).join('; ') : '';
    throw new ApiError(res.status, body?.error?.code ?? 'error', [body?.error?.message ?? res.statusText, detailText].filter(Boolean).join(' — '), details);
  }
  return body as T;
}

export const post = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const put = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
