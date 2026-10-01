import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLocalState, retryPendingSignOut, signOutRemote } from './session-cleanup.ts';

const err = (status: number) => Object.assign(new Error('x'), { status });

test('clearLocalState clears token, profile, queries, cached portfolio and push preference', async () => {
  const calls: string[] = [];
  await clearLocalState({
    email: 'a@example.com',
    clearToken: async () => void calls.push('token'),
    clearProfile: async () => void calls.push('profile'),
    googleSignOut: async () => void calls.push('google'),
    clearQueries: () => void calls.push('queries'),
    clearPortfolioCache: (e) => void calls.push(`cache:${e}`),
    clearPushPreference: async () => void calls.push('push'),
  });
  assert.deepEqual(calls, ['token', 'profile', 'google', 'queries', 'cache:a@example.com', 'push']);
});

test('clearLocalState keeps going when a step fails and tolerates an unknown email', async () => {
  const calls: string[] = [];
  await clearLocalState({
    email: null,
    clearToken: async () => {
      throw new Error('keystore');
    },
    clearProfile: async () => void calls.push('profile'),
    googleSignOut: async () => {
      throw new Error('play services');
    },
    clearQueries: () => void calls.push('queries'),
    clearPortfolioCache: () => void calls.push('cache'),
    clearPushPreference: async () => void calls.push('push'),
  });
  assert.deepEqual(calls, ['profile', 'queries', 'push']);
});

test('signOutRemote revokes, or queues the token when the server is unreachable or failing', async () => {
  const queued: string[] = [];
  const queue = async (t: string) => void queued.push(t);
  assert.equal(await signOutRemote({ token: 't', revoke: async () => {}, queue }), 'revoked');
  assert.equal(await signOutRemote({ token: 't', revoke: async () => Promise.reject(err(0)), queue }), 'queued');
  assert.equal(await signOutRemote({ token: 't2', revoke: async () => Promise.reject(err(503)), queue }), 'queued');
  assert.deepEqual(queued, ['t', 't2']);
});

test('signOutRemote does not queue when the session is already gone, or there is no token', async () => {
  const queue = async () => assert.fail('must not queue');
  assert.equal(await signOutRemote({ token: 't', revoke: async () => Promise.reject(err(401)), queue }), 'revoked');
  assert.equal(await signOutRemote({ token: 't', revoke: async () => Promise.reject(err(404)), queue }), 'revoked');
  assert.equal(await signOutRemote({ token: null, revoke: async () => assert.fail('no token'), queue }), 'none');
});

test('retryPendingSignOut clears the queue on success and keeps it while still offline', async () => {
  let stored: string | null = 'tok';
  const clear = async () => void (stored = null);
  const read = async () => stored;
  assert.equal(await retryPendingSignOut({ read, revoke: async () => Promise.reject(err(0)), clear }), true);
  assert.equal(stored, 'tok');
  assert.equal(await retryPendingSignOut({ read, revoke: async () => {}, clear }), false);
  assert.equal(stored, null);
  assert.equal(await retryPendingSignOut({ read, revoke: async () => assert.fail('nothing queued'), clear }), false);
});

test('retryPendingSignOut drops a token the server no longer knows', async () => {
  let stored: string | null = 'tok';
  const done = await retryPendingSignOut({ read: async () => stored, revoke: async () => Promise.reject(err(401)), clear: async () => void (stored = null) });
  assert.equal(done, false);
  assert.equal(stored, null);
});
