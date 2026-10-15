// Firebase Cloud Messaging sender for the native Android app. Expo tokens (`ExponentPushToken[...]`) keep going through
// Expo's push service; the native app registers `fcm:<token>`. Same privacy rule as lib/dividend-push.ts: the payload is a
// generic title and body plus a closed `kind`, never a ticker, amount or holding.
//
// Needs the Worker/Actions secret FCM_SERVICE_ACCOUNT_JSON (a Firebase service account with the Cloud Messaging API enabled).
// Uses only fetch and WebCrypto, so it runs in the Worker, the cron Worker and Node.
import { isExpoPushToken } from './dividend-push.ts';

export const FCM_PREFIX = 'fcm:';
const FCM_TOKEN = /^[A-Za-z0-9_:.-]{20,4096}$/;
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export const isFcmToken = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(FCM_PREFIX) && FCM_TOKEN.test(value.slice(FCM_PREFIX.length));
export const isPushToken = (value: unknown): value is string => isExpoPushToken(value) || isFcmToken(value);
export const fcmRawToken = (token: string) => token.slice(FCM_PREFIX.length);

export type FcmPayload = { title: string; body: string; kind?: 'market-update' | 'test' };
export type ServiceAccount = { client_email: string; private_key: string; project_id: string; token_uri?: string };

/** Parses the secret; null when it is missing or not a usable service account (so callers skip FCM quietly). */
export function parseServiceAccount(json: string | undefined | null): ServiceAccount | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<ServiceAccount>;
    return value.client_email && value.private_key && value.project_id ? (value as ServiceAccount) : null;
  } catch {
    return null;
  }
}

export function buildFcmMessage(token: string, payload: FcmPayload) {
  return {
    message: {
      token: fcmRawToken(token),
      notification: { title: payload.title, body: payload.body },
      data: { kind: payload.kind ?? 'market-update' },
      android: { priority: 'HIGH', notification: { channel_id: 'dividends' } },
    },
  };
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let text = '';
  for (const byte of data) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signJwt(account: ServiceAccount, now: Date): Promise<string> {
  const pem = account.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3000 }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(signature)}`;
}

export async function fcmAccessToken(account: ServiceAccount, fetcher: typeof fetch = fetch, now = new Date()): Promise<string> {
  const response = await fetcher(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(account, now) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string } | null;
  if (!response.ok || !body?.access_token) throw new Error(`Google sign-in for push failed (${response.status}).`);
  return body.access_token;
}

export type FcmResult = { sent: number; failed: number; unregistered: string[]; error?: string };

/**
 * Sends one identical message to each distinct valid `fcm:` token. Tokens Google no longer knows (uninstalled app) come back
 * in `unregistered` so the caller can forget them. Never throws: a missing secret or a Google outage is reported in `error`.
 */
export async function sendFcm(serviceAccountJson: string | undefined | null, tokens: Iterable<string>, payload: FcmPayload, fetcher: typeof fetch = fetch): Promise<FcmResult> {
  const result: FcmResult = { sent: 0, failed: 0, unregistered: [] };
  const unique = [...new Set([...tokens].filter(isFcmToken))];
  if (!unique.length) return result;
  const account = parseServiceAccount(serviceAccountJson);
  if (!account) return { ...result, failed: unique.length, error: 'FCM_SERVICE_ACCOUNT_JSON is not set.' };
  try {
    const access = await fcmAccessToken(account, fetcher);
    for (const token of unique) {
      const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
        body: JSON.stringify(buildFcmMessage(token, payload)),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        result.sent += 1;
        continue;
      }
      result.failed += 1;
      const text = await response.text().catch(() => '');
      if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) result.unregistered.push(token);
      else result.error = `FCM answered ${response.status}.`;
    }
  } catch (error) {
    return { ...result, failed: unique.length - result.sent, error: error instanceof Error ? error.message : 'FCM failed.' };
  }
  return result;
}
