'use client';

import { useEffect } from 'react';

/**
 * A deploy replaces the hashed chunk files, so a tab opened before it can 404 on a lazy chunk. Vite reports that as
 * `vite:preloadError`; reload once (guarded per tab) to pick up the new build instead of showing a broken page.
 */
export function StaleBuildReload() {
  useEffect(() => {
    const onError = (event: Event) => {
      try {
        if (sessionStorage.getItem('sipwise.stale-reload')) return;
        sessionStorage.setItem('sipwise.stale-reload', '1');
      } catch {
        return;
      }
      event.preventDefault();
      window.location.reload();
    };
    window.addEventListener('vite:preloadError', onError);
    // A page that has loaded fine since then may reload again for a later deploy.
    const clear = window.setTimeout(() => {
      try {
        sessionStorage.removeItem('sipwise.stale-reload');
      } catch {
        // Storage can be blocked.
      }
    }, 15_000);
    return () => {
      window.removeEventListener('vite:preloadError', onError);
      window.clearTimeout(clear);
    };
  }, []);
  return null;
}
