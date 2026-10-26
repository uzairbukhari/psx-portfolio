'use client';
// Usage analytics for the web app: queues catalog events (lib/analytics-events.ts: feature and screen names only, never
// tickers or amounts) and sends them in batches to /api/events. Honours the "Share usage stats" switch in
// Settings (on by default, stored on this device).
import { clsBucket, timingBucket, validateEvent, type EventName, type EventProps } from '@/lib/analytics-events';
import type { IncomingEvent } from '@/lib/analytics-events';
import { onPlatformError } from '@/lib/safe-json';
import { classifyError, type ErrorArea, type ErrorCode } from '@/lib/error-codes';

const OPT_OUT_KEY = 'sipwise.analytics.optout';
const ANON_KEY = 'sipwise.analytics.anon';
const FLUSH_MS = 30_000;
// Short commit of the build (vite.config.ts define), so the dashboard can split web usage and errors by release.
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined;
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
      body: JSON.stringify({ sessionId: session, platform: 'web', appVersion: APP_VERSION, events: [{ event: 'account_state', props: { vault: vaultExists ? 'exists' : 'none' } }] }),
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
    const res = await fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session, anonId: id('localStorage', ANON_KEY), platform: 'web', appVersion: APP_VERSION, events }),
    });
    if (res.status >= 500 || res.status === 429) requeue(events);
  } catch {
    // Offline or the platform is down: keep the events and try again later (analytics must never get in the way).
    requeue(events);
  }
}

const MAX_QUEUED = 200;
const RETRY_MS = 60_000;
/** Puts unsent events back in front of the queue (bounded) and tries again after a pause or when the browser is back online. */
function requeue(events: IncomingEvent[]) {
  queue.unshift(...events);
  if (queue.length > MAX_QUEUED) queue.length = MAX_QUEUED;
  timer ??= setTimeout(() => void flushAnalytics(), RETRY_MS);
  if (!onlineHooked && typeof window !== 'undefined') {
    onlineHooked = true;
    window.addEventListener('online', () => void flushAnalytics());
  }
}
let onlineHooked = false;

const SCREEN_BY_PATH: [RegExp, string][] = [
  [/^\/company\//, 'company'], [/^\/(activity|history)/, 'activity'], [/^\/(reports|insights)/, 'reports'], [/^\/plan\/?$/, 'plan'],
  [/^\/sip-tracker/, 'sip_tracker'], [/^\/(sip|monthly-picks)/, 'sip'], [/^\/research-desk/, 'research_desk'], [/^\/ai-lab/, 'ai_lab'],
  [/^\/currency\//, 'currency'], [/^\/future/, 'future'], [/^\/zakat/, 'zakat'], [/^\/feedback/, 'feedback'],
  [/^\/settings/, 'settings'], [/^\/notifications/, 'notifications'], [/^\/overview/, 'overview'], [/^\/$/, 'holdings'],
];
const reported = new Set<string>();

/** Records a user-facing error for the audit log: only a category, code and screen leave the device, never the message. */
export function reportError(message: unknown, fallbackArea: ErrorArea = 'other', fallbackCode: ErrorCode = 'unknown') {
  if (typeof window === 'undefined') return;
  const text = message instanceof Error ? message.message : typeof message === 'string' ? message : '';
  const { area, code } = classifyError(text, fallbackArea, fallbackCode);
  const path = window.location.pathname;
  const screen = SCREEN_BY_PATH.find(([re]) => re.test(path))?.[1];
  const key = `${area}:${code}:${screen ?? ''}`;
  if (reported.has(key)) return; // one of each per session is enough to trace it
  reported.add(key);
  track('client_error', screen ? { area, code, screen } : { area, code });
}

let hookedErrors = false;
/** Captures uncaught errors and failed chunk loads. Call once from a mounted client component. */
export function hookGlobalErrors() {
  if (typeof window === 'undefined' || hookedErrors) return;
  hookedErrors = true;
  window.addEventListener('error', (e) => reportError(e.message || '', 'app', 'uncaught'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'app', 'uncaught'));
  // Cloudflare's own error pages (Worker over its limits, platform trouble): recorded as a category and code only.
  onPlatformError((code) => reportError('', 'platform', code));
}

let hookedVitals = false;
/**
 * Records Core Web Vitals once per page load as a metric, rating and bucket (never the exact value), tagged with the
 * screen. `web-vitals` is loaded on demand so it stays out of the first paint.
 */
export function hookWebVitals() {
  if (typeof window === 'undefined' || hookedVitals) return;
  hookedVitals = true;
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const send = (m: { name: string; value: number; rating: string }) => {
      const screen = SCREEN_BY_PATH.find(([re]) => re.test(window.location.pathname))?.[1];
      const bucket = m.name === 'CLS' ? clsBucket(m.value) : timingBucket(m.value);
      const rating = m.rating === 'needs-improvement' ? 'ni' : m.rating;
      track('web_vital', { metric: m.name.toLowerCase(), rating, bucket, ...(screen ? { screen } : {}) });
    };
    onCLS(send); onFCP(send); onINP(send); onLCP(send); onTTFB(send);
  }, () => {});
}

/** Records how long a step took, as a bucket. Returns the stop function; call it when the step finishes. */
export function startTiming(op: 'vault_unlock' | 'first_holdings' | 'picks_run' | 'import_parse') {
  const start = typeof performance === 'undefined' ? Date.now() : performance.now();
  return () => {
    const end = typeof performance === 'undefined' ? Date.now() : performance.now();
    track('timing', { op, bucket: timingBucket(end - start) });
  };
}
