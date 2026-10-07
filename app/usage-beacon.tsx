'use client';
import { useEffect } from 'react';
import { flushAnalytics, track } from './analytics';

/** Signed-out public pages: records which page was viewed and when someone clicks Sign in. */
export function UsageBeacon() {
  useEffect(() => {
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    if (path === '/') {
      track('landing_viewed');
      track('screen_viewed', { screen: 'landing' });
    } else if (path === '/privacy' || path === '/terms') track('screen_viewed', { screen: path.slice(1) });
    function onClick(e: MouseEvent) {
      const link = (e.target as Element | null)?.closest?.('a[href^="/api/auth/google/login"]');
      if (!link) return;
      track('sign_in_clicked');
      void flushAnalytics();
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
