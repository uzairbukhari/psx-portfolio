import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signSession,
  verifySession,
  serializeCookie,
  serializeExpiredCookie,
  readCookieValue,
} from '../lib/session.ts';

test('a signed session round-trips to the original email', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  assert.equal(await verifySession(token, 'test-secret'), 'owner@example.com');
});

test('a tampered payload is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ email: 'attacker@example.com', exp: Date.now() + 100000 }),
  ).toString('base64url');
  assert.equal(
    await verifySession(`${forgedPayload}.${signature}`, 'test-secret'),
    null,
  );
});

test('a tampered signature is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  const [payload] = token.split('.');
  assert.equal(await verifySession(`${payload}.deadbeef`, 'test-secret'), null);
});

test('the wrong secret is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  assert.equal(await verifySession(token, 'wrong-secret'), null);
});

test('an expired session is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret', -1000);
  assert.equal(await verifySession(token, 'test-secret'), null);
});

test('malformed tokens are rejected without throwing', async () => {
  assert.equal(await verifySession('not-a-token', 'test-secret'), null);
  assert.equal(await verifySession('', 'test-secret'), null);
});

test('serializeCookie sets HttpOnly, Secure, SameSite=Lax and the given Max-Age', () => {
  const header = serializeCookie('session', 'abc123', { maxAge: 60 });
  assert.match(header, /^session=abc123;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
});

test('serializeExpiredCookie clears the cookie with Max-Age=0', () => {
  assert.match(serializeExpiredCookie('session'), /Max-Age=0/);
});

test('readCookieValue finds a named cookie among several', () => {
  const header = 'a=1; session=abc%20123; b=2';
  assert.equal(readCookieValue(header, 'session'), 'abc 123');
  assert.equal(readCookieValue(header, 'missing'), null);
});
