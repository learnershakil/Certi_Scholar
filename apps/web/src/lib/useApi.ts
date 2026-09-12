'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Small data hook: loads on mount and when `path` changes; optional polling while a condition holds. */
export function useApi<T>(path: string | null, opts: { pollMs?: number; pollWhile?: (data: T) => boolean; retryOnError?: boolean } = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { pollMs, pollWhile, retryOnError } = opts;
  useEffect(() => {
    const shouldPoll = data !== undefined ? !pollWhile || pollWhile(data) : Boolean(error && retryOnError);
    if (!pollMs || !shouldPoll) return;
    const t = setTimeout(reload, pollMs);
    return () => clearTimeout(t);
  }, [data, error, pollMs, pollWhile, retryOnError, reload]);

  return { data, error, loading, reload, setData };
}
