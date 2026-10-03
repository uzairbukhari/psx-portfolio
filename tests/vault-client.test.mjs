import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../lib/vault-client.ts';
import * as v from '../lib/vault-crypto.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';

const PASSWORD = 'correct horse battery staple';
const MARKER = 'SYNTH-MARKER-QUOKKA-5521';
const web = { randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(globalThis.crypto.subtle) };
const mobile = { randomBytes: web.randomBytes, ...v.nobleAes };
test.beforeEach(() => v.setCryptoAdapter(web));
test.afterEach(() => v.setCryptoAdapter(null));

async function setup(server, email = 'a@example.com', cache = memoryVaultCache()) {
  const transport = server.as(email);
  const prepared = await c.prepareVault(transport, PASSWORD, cache);
  const session = await prepared.finish();
  return { transport, session, recovery: prepared.recoverySecret, cache };
}
const withMarker = (p, ticker = 'MARKERCO') => ({ ...p, companies: [{ ticker, name: MARKER, sector: 'Bank', target: 0, approved: false, screenDate: '', note: MARKER }] });
async function open(server, email, secret, cache) {
  const transport = server.as(email);
  const status = await c.loadVaultStatus(transport, cache);
  assert.equal(status.state, 'locked');
  return c.unlockVault(transport, status, secret, cache);
}

test('prepare uploads nothing until finish(); the server holds only ciphertext afterwards', async () => {
  const server = createVaultServer();
  const transport = server.as('a@example.com');
  const prepared = await c.prepareVault(transport, PASSWORD);
  assert.equal(server.log.length, 0, 'no request before the recovery key is confirmed');
  assert.equal((await c.loadVaultStatus(transport)).state, 'none');
  const session = await prepared.finish();
  assert.equal(session.revision, 1);
  assert.equal(session.active, true);
  const posted = server.log.find((e) => e.method === 'POST');
  assert.ok(!posted.body.includes(prepared.recoverySecret) && !posted.body.includes(PASSWORD));
  await assert.rejects(prepared.finish(), /already created/);
});

test('save then unlock from another "device": password and recovery both open the same data', async () => {
  const server = createVaultServer();
  const { session, recovery } = await setup(server);
  const rev = await session.save(withMarker(session.portfolio), session.revision);
  assert.equal(rev, 2);
  for (const secret of [{ password: PASSWORD }, { recovery }]) {
    const other = await open(server, 'a@example.com', secret, memoryVaultCache());
    assert.equal(other.revision, 2);
    assert.equal(other.portfolio.companies[0].name, MARKER);
  }
  // The raw database never saw the marker, the password or the recovery key.
  const dump = JSON.stringify([server.db.sqlite.prepare('SELECT * FROM vaults').all(), server.db.sqlite.prepare('SELECT * FROM vault_portfolios').all(), server.log]);
  assert.ok(!dump.includes('QUOKKA') && !dump.includes('MARKERCO') && !dump.includes(recovery) && !dump.includes(PASSWORD));
});

test('web-written vault opens with the mobile (pure JS) adapter and vice versa', async () => {
  const server = createVaultServer();
  v.setCryptoAdapter(web);
  const { session } = await setup(server);
  await session.save(withMarker(session.portfolio), session.revision);
  v.setCryptoAdapter(mobile);
  const onPhone = await open(server, 'a@example.com', { password: PASSWORD }, memoryVaultCache());
  assert.equal(onPhone.portfolio.companies[0].name, MARKER);
  await onPhone.save({ ...onPhone.portfolio, notifications: [] }, onPhone.revision);
  v.setCryptoAdapter(web);
  const back = await open(server, 'a@example.com', { password: PASSWORD }, memoryVaultCache());
  assert.equal(back.revision, 3);
  assert.deepEqual(back.portfolio.notifications, []);
});

test('wrong password and wrong recovery do not unlock; nothing is leaked on failure', async () => {
  const server = createVaultServer();
  await setup(server);
  const transport = server.as('a@example.com');
  const status = await c.loadVaultStatus(transport);
  await assert.rejects(c.unlockVault(transport, status, { password: PASSWORD + '!' }), (e) => e.code === 'wrong-password');
  await assert.rejects(c.unlockVault(transport, status, { recovery: 'SIPW-nope' }), (e) => e.code === 'bad-recovery-format');
});

test('lock zeroes the key, drops decrypted state, and refuses further work', async () => {
  const server = createVaultServer();
  const { session } = await setup(server);
  await session.save(withMarker(session.portfolio), 1);
  let fired = 0;
  session.onLock(() => fired++);
  session.lock();
  assert.equal(session.active, false);
  assert.equal(fired, 1);
  assert.deepEqual(session.portfolio, blankPortfolio());
  await assert.rejects(session.save(blankPortfolio(), 2), c.VaultLockedError);
  await assert.rejects(session.reload(), c.VaultLockedError);
  await assert.rejects(session.changePassword(PASSWORD, PASSWORD + '2'), c.VaultLockedError);
  session.lock(); // idempotent
  assert.equal(fired, 1);
});

test('a request in flight when the vault locks never repopulates state or reports success', async () => {
  const server = createVaultServer();
  const { session } = await setup(server);
  let release;
  server.state.hold = new Promise((r) => (release = r));
  const reload = session.reload().then(() => 'resolved', (e) => e);
  const save = session.save(withMarker(session.portfolio), session.revision).then(() => 'resolved', (e) => e);
  await new Promise((r) => setTimeout(r, 5));
  session.lock();
  server.state.hold = null;
  release();
  assert.ok((await reload) instanceof c.VaultLockedError);
  assert.ok((await save) instanceof c.VaultLockedError);
  assert.deepEqual(session.portfolio, blankPortfolio());
  assert.equal(session.revision, 0);
});

test('conflicting saves from two devices: one wins, the other gets ConflictError and nothing is overwritten', async () => {
  const server = createVaultServer();
  const { session: one } = await setup(server);
  const two = await open(server, 'a@example.com', { password: PASSWORD }, memoryVaultCache());
  await one.save(withMarker(one.portfolio, 'AAAA'), one.revision);
  await assert.rejects(two.save(withMarker(two.portfolio, 'BBBB'), two.revision), c.ConflictError);
  const fresh = await two.reload();
  assert.equal(fresh.portfolio.companies[0].ticker, 'AAAA');
  assert.equal(fresh.revision, 2);
  assert.equal(await two.save(withMarker(fresh.portfolio, 'CCCC'), fresh.revision), 3);
});

test('a failed save changes nothing: network failure leaves the open portfolio and revision as they were', async () => {
  const server = createVaultServer();
  const { session } = await setup(server);
  const before = JSON.stringify(session.portfolio);
  server.state.offline = true;
  await assert.rejects(session.save(withMarker(session.portfolio), session.revision), (e) => c.isOffline(e));
  assert.equal(JSON.stringify(session.portfolio), before);
  assert.equal(session.revision, 1);
  server.state.offline = false;
  assert.equal(await session.save(withMarker(session.portfolio), session.revision), 2);
});

test('offline unlock from the ciphertext-only cache; the cache never holds readable data', async () => {
  const server = createVaultServer();
  const cache = memoryVaultCache();
  const { session } = await setup(server, 'a@example.com', cache);
  await session.save(withMarker(session.portfolio), 1);
  session.lock();
  const cached = JSON.stringify(cache.peek());
  assert.ok(!cached.includes('QUOKKA') && !cached.includes('MARKERCO') && !cached.includes(PASSWORD));
  server.state.offline = true;
  const status = await c.loadVaultStatus(server.as('a@example.com'), cache);
  assert.equal(status.offline, true);
  const offline = await c.unlockVault(server.as('a@example.com'), status, { password: PASSWORD }, cache);
  assert.equal(offline.offline, true);
  assert.equal(offline.portfolio.companies[0].name, MARKER);
  // Saving while offline fails visibly (no hidden queue); reload keeps what is open.
  await assert.rejects(offline.save(offline.portfolio, offline.revision), (e) => c.isOffline(e));
  assert.equal((await offline.reload()).revision, 2);
  // Recovery-based password reset needs the server.
  await assert.rejects(c.recoverWithKey(server.as('a@example.com'), status, 'x', PASSWORD + 'z', cache));
  // Never cached before: unreachable server and no cache = an error, not a fake empty vault.
  await assert.rejects(c.loadVaultStatus(server.as('a@example.com'), memoryVaultCache()), (e) => c.isOffline(e));
});

test('password change rewraps the same key: old password stops working, data and recovery still open', async () => {
  const server = createVaultServer();
  const { session, recovery } = await setup(server);
  await session.save(withMarker(session.portfolio), 1);
  await assert.rejects(session.changePassword('not the password at all', 'brand new passphrase long'), (e) => e.code === 'wrong-password');
  await assert.rejects(session.changePassword(PASSWORD, 'short'), (e) => e.code === 'weak-password');
  await session.changePassword(PASSWORD, 'brand new passphrase long');
  assert.equal(session.wrapperVersion, 2);
  const status = await c.loadVaultStatus(server.as('a@example.com'));
  await assert.rejects(c.unlockVault(server.as('a@example.com'), status, { password: PASSWORD }), (e) => e.code === 'wrong-password');
  const reopened = await c.unlockVault(server.as('a@example.com'), status, { password: 'brand new passphrase long' });
  assert.equal(reopened.portfolio.companies[0].name, MARKER);
  assert.equal(reopened.revision, 2, 'password change does not re-encrypt or bump the portfolio');
  assert.ok((await c.unlockVault(server.as('a@example.com'), status, { recovery })).active);
});

test('two devices changing the password at once: the stale one is refused, never silently overwriting', async () => {
  const server = createVaultServer();
  const { session: one } = await setup(server);
  const two = await open(server, 'a@example.com', { password: PASSWORD }, memoryVaultCache());
  await one.changePassword(PASSWORD, 'first new passphrase here');
  await assert.rejects(two.changePassword(PASSWORD, 'second new passphrase here'), (e) => e instanceof c.TransportError && e.code === 'wrapper-conflict');
  const status = await c.loadVaultStatus(server.as('a@example.com'));
  assert.ok((await c.unlockVault(server.as('a@example.com'), status, { password: 'first new passphrase here' })).active);
});

test('forgotten password: recovery key unlocks and sets a new password; the old recovery key keeps working', async () => {
  const server = createVaultServer();
  const { session, recovery } = await setup(server);
  await session.save(withMarker(session.portfolio), 1);
  const transport = server.as('a@example.com');
  const status = await c.loadVaultStatus(transport);
  const recovered = await c.recoverWithKey(transport, status, recovery, 'a completely new passphrase', memoryVaultCache());
  assert.equal(recovered.portfolio.companies[0].name, MARKER);
  const again = await c.loadVaultStatus(transport);
  await assert.rejects(c.unlockVault(transport, again, { password: PASSWORD }), (e) => e.code === 'wrong-password');
  assert.ok((await c.unlockVault(transport, again, { password: 'a completely new passphrase' })).active);
  assert.ok((await c.unlockVault(transport, again, { recovery })).active);
  await assert.rejects(c.recoverWithKey(transport, again, recovery.slice(0, -4) + '0000', 'whatever passphrase long'), (e) => ['bad-recovery-format', 'wrong-recovery'].includes(e.code));
});

test('recovery-key replacement: old key stops working only after the new one is committed', async () => {
  const server = createVaultServer();
  const { session, recovery } = await setup(server);
  const prepared = await session.prepareRecovery();
  assert.notEqual(prepared.recoverySecret, recovery);
  let status = await c.loadVaultStatus(server.as('a@example.com'));
  assert.ok((await c.unlockVault(server.as('a@example.com'), status, { recovery })).active, 'prepare alone changes nothing');
  await session.commitRecovery(prepared);
  status = await c.loadVaultStatus(server.as('a@example.com'));
  await assert.rejects(c.unlockVault(server.as('a@example.com'), status, { recovery }), (e) => e.code === 'wrong-recovery');
  assert.ok((await c.unlockVault(server.as('a@example.com'), status, { recovery: prepared.recoverySecret })).active);
  assert.ok((await c.unlockVault(server.as('a@example.com'), status, { password: PASSWORD })).active);
});

test('account isolation: another user, and a super-admin session, see no vault and cannot overwrite', async () => {
  const server = createVaultServer();
  const { session } = await setup(server, 'a@example.com');
  assert.equal((await c.loadVaultStatus(server.as('admin@example.com'))).state, 'none');
  assert.equal((await c.loadVaultStatus(server.as('b@example.com'))).state, 'none');
  const b = await setup(server, 'b@example.com');
  await b.session.save(withMarker(b.session.portfolio, 'BONLY'), 1);
  const a = await session.reload();
  assert.equal(a.portfolio.companies.length, 0);
  // A's key cannot open B's ciphertext even if the rows were swapped by a database operator.
  const rowB = server.db.sqlite.prepare("SELECT envelope FROM vault_portfolios p JOIN vaults v ON v.vault_id=p.vault_id WHERE v.owner='b@example.com'").get();
  const envB = JSON.parse(rowB.envelope);
  await assert.rejects(v.decryptPortfolio(await (async () => { const s = await c.loadVaultStatus(server.as('a@example.com')); return v.unwrapWithPassword(s.vault, PASSWORD); })(), envB, { vaultId: envB.vaultId, keyVersion: 1, revision: envB.revision }), (e) => e.code === 'tampered');
});

test('a database operator swapping or rolling an envelope into another slot is detected on open', async () => {
  const server = createVaultServer();
  const { session } = await setup(server, 'a@example.com');
  await session.save(withMarker(session.portfolio), 1);
  const b = await setup(server, 'b@example.com');
  // Copy B's envelope over A's row (same revision number would even match).
  const rowB = server.db.sqlite.prepare("SELECT p.envelope AS e FROM vault_portfolios p JOIN vaults v ON v.vault_id=p.vault_id WHERE v.owner='b@example.com'").get();
  server.db.sqlite.prepare("UPDATE vault_portfolios SET envelope=?, revision=2 WHERE vault_id=(SELECT vault_id FROM vaults WHERE owner='a@example.com')").run(rowB.e);
  const status = await c.loadVaultStatus(server.as('a@example.com'));
  await assert.rejects(c.unlockVault(server.as('a@example.com'), status, { password: PASSWORD }), (e) => e.code === 'tampered');
  // Flipping a ciphertext byte is caught too.
  server.db.sqlite.prepare("UPDATE vault_portfolios SET envelope=? WHERE vault_id=(SELECT vault_id FROM vaults WHERE owner='b@example.com')").run(JSON.stringify({ ...JSON.parse(rowB.e), ct: 'A' + JSON.parse(rowB.e).ct.slice(1) }));
  const sb = await c.loadVaultStatus(server.as('b@example.com'));
  await assert.rejects(c.unlockVault(server.as('b@example.com'), sb, { password: PASSWORD }), (e) => e.code === 'tampered');
});

test('oversized plaintext is refused client-side before anything is sent', async () => {
  const server = createVaultServer();
  const { session } = await setup(server);
  const before = server.log.length;
  await assert.rejects(session.save({ ...session.portfolio, note: 'x'.repeat(4_100_000) }, session.revision), (e) => e.code === 'too-large');
  assert.equal(server.log.length, before);
});

test('vault reset (both secrets lost) erases ciphertext; a new vault can then be created', async () => {
  const server = createVaultServer();
  const { session, transport } = await setup(server);
  await session.save(withMarker(session.portfolio), 1);
  await transport.deleteVault();
  assert.equal(server.db.sqlite.prepare('SELECT COUNT(*) AS n FROM vault_portfolios').get().n, 0);
  assert.equal((await c.loadVaultStatus(transport)).state, 'none');
  const again = await c.prepareVault(transport, PASSWORD);
  assert.equal((await again.finish()).portfolio.companies.length, 0);
});
