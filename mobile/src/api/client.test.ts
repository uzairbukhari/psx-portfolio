import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiRequestError } from './client.ts';

const json = (status: number, body: unknown) => Response.json(body, { status });

test('sends the bearer token and parses JSON', async () => {
  let seen: Headers | undefined;
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => 'tok',
    fetcher: (async (_url: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return json(200, { ok: true });
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(await api.get('/api/me'), { ok: true });
  assert.equal(seen?.get('authorization'), 'Bearer tok');
});

test('401 calls onUnauthorized and throws the server message', async () => {
  let signedOut = 0;
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => 'tok',
    onUnauthorized: () => signedOut++,
    fetcher: (async () => json(401, { error: 'Sign in to access your portfolio.' })) as unknown as typeof fetch,
  });
  await assert.rejects(() => api.get('/api/portfolio'), (e: unknown) => e instanceof ApiRequestError && e.status === 401 && /Sign in/.test(e.message));
  assert.equal(signedOut, 1);
});

test('unauthenticated sign-in call sends no token and does not trigger sign-out', async () => {
  let auth: string | null = 'unset';
  let signedOut = 0;
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => 'tok',
    onUnauthorized: () => signedOut++,
    fetcher: (async (_u: string, init: RequestInit) => {
      auth = new Headers(init.headers).get('authorization');
      return json(401, { error: 'Google sign-in was not accepted.' });
    }) as unknown as typeof fetch,
  });
  await assert.rejects(() => api.post('/api/auth/mobile/google', { idToken: 'x' }, false));
  assert.equal(auth, null);
  assert.equal(signedOut, 0);
});

test('network failure becomes a friendly error', async () => {
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => null,
    fetcher: (async () => { throw new TypeError('network'); }) as unknown as typeof fetch,
  });
  await assert.rejects(() => api.get('/api/me'), /Could not reach Sipwise/);
});

test('a 503 (server could not check the session) does not sign the phone out', async () => {
  let signedOut = 0;
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => 'tok',
    onUnauthorized: () => signedOut++,
    fetcher: (async () => json(503, { error: 'Could not check your sign-in right now.' })) as unknown as typeof fetch,
  });
  await assert.rejects(() => api.get('/api/portfolio'), (e: unknown) => e instanceof ApiRequestError && e.status === 503);
  assert.equal(signedOut, 0);
});

test('delete can carry a JSON body (account deletion confirmation)', async () => {
  let seen: { method?: string; body?: unknown; auth?: string | null } = {};
  const api = createApiClient({
    baseUrl: 'https://x.test',
    getToken: async () => 'tok',
    fetcher: (async (_url: string, init: RequestInit) => {
      seen = { method: init.method, body: init.body, auth: new Headers(init.headers).get('Authorization') };
      return json(200, { deleted: true });
    }) as unknown as typeof fetch,
  });
  await api.delete('/api/me', { confirm: 'a@b.co' });
  assert.deepEqual(seen, { method: 'DELETE', body: '{"confirm":"a@b.co"}', auth: 'Bearer tok' });
  await api.delete('/api/mobile-sessions?id=1');
  assert.equal(seen.body, undefined);
});
