import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createSign } from 'node:crypto';
import ts from 'typescript';
import { signSession, verifySession } from '../lib/session.ts';
import { signMobileToken, verifyMobileToken, readBearerToken } from '../lib/mobile-token.ts';
import {
  verifyGoogleIdToken,
  resetGoogleKeyCache,
  emailAllowed,
  safeGooglePicture,
} from '../lib/google-id-token.ts';

const SECRET = 'test-secret';
const user = { email: 'a@example.com', name: 'A', picture: null, sid: 'sid-1' };

test('a mobile token round-trips and keeps the device session id', async () => {
  const token = await signMobileToken(user, SECRET);
  assert.deepEqual(await verifyMobileToken(token, SECRET), user);
});

test('a mobile token is rejected as a web cookie, and a cookie as a bearer token', async () => {
  const mobile = await signMobileToken(user, SECRET);
  assert.equal(await verifySession(mobile, SECRET), null);
  const cookie = await signSession('a@example.com', 'A', SECRET);
  assert.equal(await verifyMobileToken(cookie, SECRET), null);
});

test('mobile tokens reject wrong secret, tampering and expiry', async () => {
  const token = await signMobileToken(user, SECRET);
  assert.equal(await verifyMobileToken(token, 'other'), null);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), email: 'x@example.com' })).toString('base64url');
  assert.equal(await verifyMobileToken(`${forged}.${sig}`, SECRET), null);
  assert.equal(await verifyMobileToken(await signMobileToken(user, SECRET, -1000), SECRET), null);
});

test('readBearerToken parses only a Bearer header', () => {
  assert.equal(readBearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(readBearerToken('bearer abc'), 'abc');
  assert.equal(readBearerToken('Basic abc'), null);
  assert.equal(readBearerToken(null), null);
});

// --- Google ID token ---
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function idToken(claims, { kid = 'k1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64(claims);
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${signature}`;
}
const now = Date.now();
const good = { iss: 'https://accounts.google.com', aud: 'ios-client', exp: Math.floor(now / 1000) + 600, email: 'Me@Example.com', email_verified: true, name: 'Me', picture: 'https://lh3.googleusercontent.com/a/x' };
let fetches = 0;
const fetcher = async () => { fetches++; return Response.json({ keys: [jwk] }); };

test('a valid Google ID token yields a lower-cased identity', async () => {
  resetGoogleKeyCache();
  const identity = await verifyGoogleIdToken(idToken(good), ['ios-client', 'android-client'], { fetcher, now });
  assert.deepEqual(identity, { email: 'me@example.com', name: 'Me', picture: 'https://lh3.googleusercontent.com/a/x' });
});

test('Google ID tokens are rejected for wrong audience, issuer, expiry, unverified email or forged signature', async () => {
  const check = (claims, opts) => verifyGoogleIdToken(idToken(claims, opts), ['ios-client'], { fetcher, now });
  assert.equal(await check({ ...good, aud: 'someone-else' }), null);
  assert.equal(await check({ ...good, iss: 'https://evil.example' }), null);
  assert.equal(await check({ ...good, exp: Math.floor(now / 1000) - 5 }), null);
  assert.equal(await check({ ...good, email_verified: false }), null);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await check(good, { key: other.privateKey }), null);
  assert.equal(await verifyGoogleIdToken(idToken(good), [], { fetcher, now }), null);
  assert.equal(await verifyGoogleIdToken('not.a.jwt', ['ios-client'], { fetcher, now }), null);
});

test('signing keys are cached between verifications', async () => {
  resetGoogleKeyCache();
  fetches = 0;
  await verifyGoogleIdToken(idToken(good), ['ios-client'], { fetcher, now });
  await verifyGoogleIdToken(idToken(good), ['ios-client'], { fetcher, now });
  assert.equal(fetches, 1);
});

test('email allow-list: empty allows anyone, otherwise case-insensitive match', () => {
  assert.equal(emailAllowed('a@b.com', ''), true);
  assert.equal(emailAllowed('a@b.com', undefined), true);
  assert.equal(emailAllowed('A@B.com', 'a@b.com, c@d.com'), true);
  assert.equal(emailAllowed('x@y.com', 'a@b.com'), false);
});

test('only https googleusercontent pictures are kept', () => {
  assert.equal(safeGooglePicture('http://lh3.googleusercontent.com/a'), null);
  assert.equal(safeGooglePicture('https://evil.example/a'), null);
  assert.ok(safeGooglePicture('https://lh3.googleusercontent.com/a'));
});

// --- identity(): origin check applies to cookies, not bearer tokens ---
async function loadServer(via) {
  const base = new URL('../', import.meta.url);
  const source = readFileSync(new URL('lib/server.ts', base), 'utf8')
    .replace("import { env } from 'cloudflare:workers';", 'const env = {};')
    .replace("import { getCurrentUser } from '@/lib/auth';", `const getCurrentUser = async () => (globalThis.__via ? { email: 'a@example.com', via: globalThis.__via } : null);`)
    .replace("import { getUserRole, isSuperAdmin } from '@/lib/roles';", 'const getUserRole = async () => "user"; const isSuperAdmin = () => false;')
    .replace("import { UserError, publicError } from '@/lib/user-error';", `import { UserError, publicError } from '${new URL('lib/user-error.ts', base).href}';`);
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  globalThis.__via = via;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${via}`);
}

test('cookie writes need a same-origin Origin header; bearer writes do not', async () => {
  const noOrigin = new Request('https://app.test/api/portfolio', { method: 'PUT' });
  const cookie = await loadServer('cookie');
  await assert.rejects(() => cookie.identity(noOrigin, true), /Invalid request origin/);
  globalThis.__via = 'cookie';
  assert.equal(await cookie.identity(new Request('https://app.test/x', { method: 'PUT', headers: { origin: 'https://app.test' } }), true), 'a@example.com');
  globalThis.__via = 'bearer';
  assert.equal(await cookie.identity(noOrigin, true), 'a@example.com');
  globalThis.__via = undefined;
  await assert.rejects(() => cookie.identity(noOrigin, true), /Sign in/);
});
