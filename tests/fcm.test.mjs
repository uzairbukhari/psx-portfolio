import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildFcmMessage, isFcmToken, isPushToken, parseServiceAccount, sendFcm } from '../lib/fcm.ts';

const TOKEN = `fcm:${'a'.repeat(40)}`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = JSON.stringify({ client_email: 'x@p.iam.gserviceaccount.com', project_id: 'proj', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

test('token validation accepts Expo and fcm: tokens only', () => {
  assert.ok(isFcmToken(TOKEN));
  assert.ok(!isFcmToken('fcm:short'));
  assert.ok(!isFcmToken('a'.repeat(40)));
  assert.ok(isPushToken('ExponentPushToken[abcdefghijkl]'));
  assert.ok(isPushToken(TOKEN));
  assert.ok(!isPushToken(42));
});

test('the message is generic and strips the prefix', () => {
  const m = buildFcmMessage(TOKEN, { title: 'T', body: 'B' }).message;
  assert.equal(m.token, 'a'.repeat(40));
  assert.deepEqual(Object.keys(m.data), ['kind']);
  assert.equal(m.android.notification.channel_id, 'dividends');
});

test('a bad or missing service account is skipped without throwing', async () => {
  assert.equal(parseServiceAccount('nope'), null);
  const r = await sendFcm(undefined, [TOKEN], { title: 't', body: 'b' });
  assert.equal(r.sent, 0);
  assert.match(r.error, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.deepEqual(await sendFcm(undefined, [], { title: 't', body: 'b' }), { sent: 0, failed: 0, unregistered: [] });
});

test('sends with a signed JWT, de-dupes tokens and reports unregistered ones', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'AT' });
    const sent = JSON.parse(init.body).message.token;
    return sent === 'b'.repeat(40) ? new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 }) : Response.json({ name: 'ok' });
  };
  const gone = `fcm:${'b'.repeat(40)}`;
  const r = await sendFcm(account, [TOKEN, TOKEN, gone, 'ExponentPushToken[abcdefghijkl]'], { title: 't', body: 'b' }, fetcher);
  assert.equal(r.sent, 1);
  assert.deepEqual(r.unregistered, [gone]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer AT');
  const assertion = new URLSearchParams(calls[0].init.body).get('assertion');
  assert.equal(assertion.split('.').length, 3);
});
