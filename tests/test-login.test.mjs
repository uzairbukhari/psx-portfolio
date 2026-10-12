import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { handleTestLogin, testLoginEnabled } from '../lib/test-login.ts';
import { verifySession } from '../lib/session.ts';
import { TEST_ACCOUNT_EMAIL } from '../lib/test-account.ts';

const env = { APP_ENV: 'staging', TEST_LOGIN_SECRET: 'open-sesame', SESSION_SECRET: 'x'.repeat(32) };
const post = (secret, init = {}) =>
  new Request('https://staging.test/api/auth/test-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: JSON.stringify({ secret }),
  });

test('disabled outside staging and without a secret', async () => {
  const db = createD1();
  assert.equal(testLoginEnabled({ ...env, APP_ENV: 'production' }), false);
  assert.equal(testLoginEnabled({ ...env, TEST_LOGIN_SECRET: '' }), false);
  assert.equal((await handleTestLogin(post('open-sesame'), { ...env, APP_ENV: 'production' }, db)).status, 404);
  assert.equal((await handleTestLogin(post('open-sesame'), { ...env, TEST_LOGIN_SECRET: undefined }, db)).status, 404);
  assert.equal((await handleTestLogin(post('open-sesame'), {}, db)).status, 404);
});

test('wrong secret is rejected and sets no cookie', async () => {
  const res = await handleTestLogin(post('nope'), env, createD1());
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('right secret signs in only the fictional test account', async () => {
  const res = await handleTestLogin(post('open-sesame'), env, createD1());
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  const token = decodeURIComponent(/session=([^;]+)/.exec(cookie)[1]);
  assert.equal((await verifySession(token, env.SESSION_SECRET)).email, TEST_ACCOUNT_EMAIL);
  assert.match(cookie, /HttpOnly/);
});

test('form post redirects home; cross-origin posts are refused; attempts are rate limited', async () => {
  const db = createD1();
  const form = new Request('https://staging.test/api/auth/test-login', { method: 'POST', body: new URLSearchParams({ secret: 'open-sesame' }) });
  const ok = await handleTestLogin(form, env, db);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  assert.equal((await handleTestLogin(post('open-sesame', { headers: { origin: 'https://evil.test' } }), env, db)).status, 403);
  let last;
  for (let i = 0; i < 25; i++) last = await handleTestLogin(post('nope'), env, db);
  assert.equal(last.status, 429);
});

test('GET shows the form only when enabled', async () => {
  const get = new Request('https://staging.test/api/auth/test-login');
  assert.equal((await handleTestLogin(get, env, createD1())).status, 200);
  assert.equal((await handleTestLogin(get, {}, createD1())).status, 404);
});
