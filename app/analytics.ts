'use client';
// Usage analytics for the web app: queues catalog events (lib/analytics-events.ts: feature and screen names only, never
// tickers or amounts) and sends them in batches to /api/events. Honours the "Share anonymous usage stats" switch in
// Settings (on by default, stored on this device).
import { validateEvent, type EventName, type EventProps } from '@/lib/analytics-events';
import type { IncomingEvent } from '@/lib/analytics-events';

const OPT_OUT_KEY = 'sipwise.analytics.optout';
const ANON_KEY = 'sipwise.analytics.anon';
const FLUSH_MS = 30_000;
const queue: IncomingEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let session: string | undefined;
let hooked = false;

function read(store: 'localStorage' | 'sessionStorage', key: string): string | null {
  try { return window[store].getItem(key); } catch { return null; }
}
function write(store: 'localStorage' | 'sessionStorage', key: string, value: string | null) {
  try { if (value === null) window[store].removeItem(key); else window[store].setItem(key, value); } catch { /* storage may be blocked */ }
}

export const analyticsEnabled = () => typeof window !== 'undefined' && read('localStorage', OPT_OUT_KEY) !== '1';

export function setAnalyticsEnabled(on: boolean) {
  write('localStorage', OPT_OUT_KEY, on ? null : '1');
  if (!on) queue.length = 0;
}

function id(store: 'localStorage' | 'sessionStorage', key: string) {
  let value = read(store, key);
  if (!value) { value = crypto.randomUUID(); write(store, key, value); }
  return value;
}

export function track<E extends EventName>(event: E, props: EventProps = {}) {
  if (typeof window === 'undefined' || !analyticsEnabled()) return;
  const clean = validateEvent({ event, props });
  if (!clean) return; // never send anything outside the catalog
  queue.push(clean);
  if (!hooked) {
    hooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAnalytics(); });
  }
  if (queue.length >= 20) void flushAnalytics();
  else timer ??= setTimeout(() => void flushAnalytics(), FLUSH_MS);
}

/**
 * Tells the server whether this account already had a vault, once per browser session and whatever the usage-sharing
 * switch says: it separates new sign-ups from existing accounts and records nothing else.
 */
export async function reportAccountState(vaultExists: boolean) {
  if (typeof window === 'undefined' || read('sessionStorage', 'sipwise.analytics.state') === '1') return;
  write('sessionStorage', 'sipwise.analytics.state', '1');
  session ??= id('sessionStorage', 'sipwise.analytics.session');
  try {
    await fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session, platform: 'web', events: [{ event: 'account_state', props: { vault: vaultExists ? 'exists' : 'none' } }] }),
    });
  } catch { /* analytics must never get in the way */ }
}

export async function flushAnalytics() {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length || !analyticsEnabled()) { queue.length = 0; return; }
  session ??= id('sessionStorage', 'sipwise.analytics.session');
  const events = queue.splice(0, 50);
  try {
    await fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session, anonId: id('localStorage', ANON_KEY), platform: 'web', events }),
    });
  } catch { /* analytics must never get in the way */ }
}
