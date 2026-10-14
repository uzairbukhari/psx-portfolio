// Shared by scripts/seed-test-account.mjs and the Playwright setup: which app a test run targets, how it signs in as
// the fictional test account, and a vault transport over HTTP. Nothing here can reach any account except the test one:
// every run first checks GET /api/me returns exactly TEST_ACCOUNT_EMAIL and aborts otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { TransportError } from '../lib/vault-client.ts';
import { TEST_ACCOUNT_EMAIL } from '../lib/test-account.ts';

export const TARGETS = {
  local: { url: 'http://127.0.0.1:5191', login: false },
  staging: { url: 'https://staging.sipwise.trade', login: true },
};

/** Reads KEY=value lines from a git-ignored env file into process.env (without overriding what is already set). */
export function loadEnvFile(file = '.env.test.local') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function resolveTarget(name, urlOverride) {
  const target = TARGETS[name];
  if (!target) throw new Error(`--target must be one of: ${Object.keys(TARGETS).join(', ')}`);
  const url = (urlOverride || process.env.E2E_BASE_URL || target.url).replace(/\/$/, '');
  if (name === 'local' && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(url)) throw new Error('The local target must be a loopback URL.');
  if (name === 'local' && /:(5173|3000)$/.test(url))
    throw new Error('Refusing port 5173/3000: that is the real dev server. Use `npm run sandbox:dev` (port 5191).');
  if (name === 'staging' && !url.startsWith('https://')) throw new Error('The staging target must be https.');
  return { name, url, login: target.login };
}

/** Signs in (staging) and returns the Cookie header to send; '' for the local sandbox, which needs none. */
export async function signIn(target) {
  if (!target.login) return '';
  loadEnvFile();
  const secret = process.env.TEST_LOGIN_SECRET;
  if (!secret) throw new Error('Set TEST_LOGIN_SECRET (environment or .env.test.local) to sign in to staging.');
  const res = await fetch(`${target.url}/api/auth/test-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: target.url },
    body: JSON.stringify({ secret }),
    redirect: 'manual',
  });
  if (res.status === 404) throw new Error('Test login is disabled there (needs APP_ENV=staging and the TEST_LOGIN_SECRET Worker secret).');
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Test login failed (${res.status}). Check TEST_LOGIN_SECRET.${detail ? ` Response: ${detail}` : ''}`);
  }
  const cookie = /(?:^|,\s*)(session=[^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!cookie) throw new Error('Test login returned no session cookie.');
  return cookie;
}

/** Throws unless the app says we are the fictional test account. This is the guard that protects real data. */
export async function assertTestAccount(target, cookie) {
  const res = await fetch(`${target.url}/api/me`, { headers: cookie ? { cookie } : {} });
  const me = await res.json().catch(() => null);
  if (!res.ok || me?.email !== TEST_ACCOUNT_EMAIL)
    throw new Error(`Refusing to continue: ${target.url} is signed in as ${me?.email ?? `nobody (${res.status})`}, not ${TEST_ACCOUNT_EMAIL}.`);
  return me;
}

/** A VaultTransport over HTTP (same shape as app/vault-transport.ts), carrying the test cookie and a same-origin Origin. */
export function httpVaultTransport(target, cookie) {
  async function call(path, method = 'GET', body) {
    let res;
    try {
      const init = {
        method,
        cache: 'no-store',
        headers: { origin: target.url, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      res = await fetch(`${target.url}${path}`, init);
    } catch {
      throw new TransportError(`Could not reach ${target.url}.`, 0);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new TransportError(data?.error ?? `Request failed (${res.status}).`, res.status, data?.code);
    return data;
  }
  return {
    getVault: () => call('/api/vault'),
    postVault: (request) => call('/api/vault', 'POST', request),
    putWrappers: (request) => call('/api/vault', 'PUT', request),
    deleteVault: async () => void (await call('/api/vault', 'DELETE', { confirm: true })),
    getPortfolio: () => call('/api/v3/portfolio'),
    putPortfolio: (request) => call('/api/v3/portfolio', 'PUT', request),
  };
}
