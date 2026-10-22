'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson } from '@/lib/safe-json';

/** Loads an admin API route, refreshes it every `everyMs` while the tab is visible, and reloads when `url` changes. */
export function useAdminData<T>(url: string, everyMs = 300_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const latest = useRef(url);
  useEffect(() => { latest.current = url; }, [url]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const body = (await readJson(res)) as T & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load this page.');
      if (latest.current === url) { setData(body); setError(null); setUpdatedAt(Date.now()); }
    } catch (e) {
      if (latest.current === url) setError(e instanceof Error ? e.message : 'Could not load this page.');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = everyMs > 0 ? window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, everyMs) : 0;
    return () => { window.clearTimeout(first); if (timer) window.clearInterval(timer); };
  }, [load, everyMs]);

  return { data, error, loading, updatedAt, reload: load };
}
