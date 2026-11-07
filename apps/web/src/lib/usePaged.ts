'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

export const PAGE_SIZE = 25;

/** Fetches one page of a list endpoint; the total comes from the X-Total-Count header the API sets for paged requests. */
async function fetchPage<T>(path: string): Promise<{ items: T[]; total: number }> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? res.statusText, body?.error?.details);
  const items = (body ?? []) as T[];
  return { items, total: Number(res.headers.get('X-Total-Count') ?? items.length) };
}

/**
 * Like useApi for list endpoints, one page at a time. `path` may carry its own filters; the page goes back to 1
 * whenever they change. Polling works as in useApi.
 */
export function usePaged<T>(path: string | null, opts: { pageSize?: number; pollMs?: number; pollWhile?: (items: T[]) => boolean } = {}) {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<T[] | undefined>();
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(Boolean(path));

  useEffect(() => setPage(1), [path]);
  const full = path ? `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}` : null;

  const reload = useCallback(async () => {
    if (!full) return;
    try {
      const r = await fetchPage<T>(full);
      // A page that emptied (e.g. after a filter or a deletion) falls back to the last page that has rows.
      if (!r.items.length && page > 1 && r.total > 0) return setPage(Math.ceil(r.total / pageSize));
      setData(r.items);
      setTotal(r.total);
      setError(undefined);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [full, page, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { pollMs, pollWhile } = opts;
  useEffect(() => {
    if (!pollMs || !data || (pollWhile && !pollWhile(data))) return;
    const t = setTimeout(reload, pollMs);
    return () => clearTimeout(t);
  }, [data, pollMs, pollWhile, reload]);

  return { data, error, loading, reload, page, setPage, pageSize, total };
}
