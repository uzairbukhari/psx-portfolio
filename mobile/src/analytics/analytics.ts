// Usage analytics for the phone app. Same rules as the web: catalog events only (lib/analytics-events.ts), feature and
// screen names, never tickers or amounts. Events go in batches to /api/events with the app token. Pure JS, so it
// ships by OTA update. Honours the "Share anonymous usage stats" switch in More (on by default).
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { validateEvent, type EventName, type EventProps, type IncomingEvent } from '../../../lib/analytics-events.ts';

const OPT_OUT_KEY = 'sipwise.analytics.optout';
const FLUSH_MS = 30_000;

type Sender = (body: unknown) => Promise<unknown>;
let send: Sender | null = null;
let enabled = true;
let loaded: Promise<void> | null = null;
const queue: IncomingEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
const sessionId = Crypto.randomUUID();
const platform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'other';
const appVersion = Constants.expoConfig?.version;

function load() {
  loaded ??= SecureStore.getItemAsync(OPT_OUT_KEY).then((v) => { enabled = v !== '1'; }, () => {});
  return loaded;
}

/** Called once the user is signed in; `post` sends an authenticated JSON POST to /api/events. */
export function configureAnalytics(post: Sender | null) {
  send = post;
  if (!post) queue.length = 0;
  void load();
}

export const analyticsEnabled = () => enabled;
export async function setAnalyticsEnabled(on: boolean) {
  enabled = on;
  if (!on) queue.length = 0;
  await SecureStore.setItemAsync(OPT_OUT_KEY, on ? '0' : '1').catch(() => {});
}
export const readAnalyticsEnabled = () => load().then(() => enabled);

export function track(event: EventName, props: EventProps = {}) {
  if (!enabled || !send) return;
  const clean = validateEvent({ event, props });
  if (!clean) return;
  queue.push(clean);
  if (queue.length >= 20) void flushAnalytics();
  else timer ??= setTimeout(() => void flushAnalytics(), FLUSH_MS);
}

let stateReported = false;
/** Tells the server whether this account already had a vault (once per launch, whatever the sharing switch says). */
export async function reportAccountState(vaultExists: boolean) {
  if (!send || stateReported) return;
  stateReported = true;
  try {
    await send({ sessionId, platform, appVersion, events: [{ event: 'account_state', props: { vault: vaultExists ? 'exists' : 'none' } }] });
  } catch { stateReported = false; }
}

export async function flushAnalytics() {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length || !enabled || !send) { queue.length = 0; return; }
  const events = queue.splice(0, 50);
  try {
    await send({ sessionId, platform, appVersion, events });
  } catch { /* analytics must never get in the way */ }
}

AppState.addEventListener('change', (state) => { if (state !== 'active') void flushAnalytics(); });
