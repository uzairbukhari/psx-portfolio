'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson } from '@/lib/safe-json';

const IDLE_MS = 10 * 60_000;

/** Loads an admin API route, refreshes it every `everyMs` while the tab is visible, and reloads when `url` changes. */
export function useAdminData<T>(url: string, everyMs = 300_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const latest = useRef(url);
  useEffect(() => { latest.current = url; }, [url]);

  // Timed refreshes may be answered from the server's two-minute cache; the Reload button asks for fresh numbers.
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(fresh ? `${url}${url.includes('?') ? '&' : '?'}fresh=1` : url, { cache: 'no-store' });
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
    // A tab left open and visible must not keep reading the database all day: timed refreshes stop after IDLE_MS
    // without a click, key press or scroll, and one catch-up load runs when the person comes back.
    let lastActive = Date.now();
    let lastLoad = Date.now();
    const refresh = () => { lastLoad = Date.now(); void load(); };
    const onActive = () => {
      const idle = Date.now() - lastActive > IDLE_MS;
      lastActive = Date.now();
      if (idle && everyMs > 0 && Date.now() - lastLoad > everyMs) refresh();
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, onActive, { passive: true });
    const timer = everyMs > 0 ? window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive <= IDLE_MS) refresh();
    }, everyMs) : 0;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, onActive);
    };
  }, [load, everyMs]);

  return { data, error, loading, updatedAt, reload: () => load(true) };
}
