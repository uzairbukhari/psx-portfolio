import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../lib/vault-client.ts';
import * as v from '../lib/vault-crypto.ts';
import * as b from '../lib/vault-backup.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';

const PASSWORD = 'correct horse battery staple';
test.beforeEach(() => v.setCryptoAdapter({ randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(globalThis.crypto.subtle) }));
test.afterEach(() => v.setCryptoAdapter(null));

const company = (ticker) => ({ ticker, name: 'Meezan Bank ' + ticker, sector: 'Bank', target: 0, approved: false, screenDate: '', note: 'SYNTH-NOTE-LYNX' });
async function seed(server, email) {
  const transport = server.as(email);
  const prepared = await c.prepareVault(transport, PASSWORD, memoryVaultCache());
  const session = await prepared.finish();
  await session.save({ ...blankPortfolio(), companies: [company('MEBL')] }, 1);
  return { session, recovery: prepared.recoverySecret };
}

test('an encrypted backup has no readable content and opens with the password or the recovery key, without a server', async () => {
  const server = createVaultServer();
  const { session, recovery } = await seed(server, 'a@example.com');
  const pkg = await session.backupPackage();
  const text = JSON.stringify(pkg);
  assert.ok(!text.includes('LYNX') && !text.includes('MEBL') && !text.includes(PASSWORD) && !text.includes(recovery));
  const parsed = b.parseBackup(text);
  assert.equal(parsed.type, 'encrypted');
  for (const secret of [{ password: PASSWORD }, { recovery }]) {
    const portfolio = await b.openBackup(parsed.backup, secret);
    assert.equal(portfolio.companies[0].ticker, 'MEBL');
  }
  await assert.rejects(b.openBackup(parsed.backup, { password: PASSWORD + 'x' }), (e) => e.code === 'wrong-password');
});

test('restore re-encrypts into the destination vault: another account, new vault id, next revision', async () => {
  const server = createVaultServer();
  const { session: source } = await seed(server, 'a@example.com');
  const pkg = JSON.stringify(await source.backupPackage());
  // A different person's fresh vault (different password, different keys).
  const transport = server.as('b@example.com');
  const prepared = await c.prepareVault(transport, 'another very long passphrase', memoryVaultCache());
  const dest = await prepared.finish();
  const portfolio = await b.openBackup(b.parseBackup(pkg).backup, { password: PASSWORD });
  const rev = await dest.save(portfolio, dest.revision);
  assert.equal(rev, 2);
  const row = server.db.sqlite.prepare("SELECT p.envelope AS e, v.vault_id AS id FROM vault_portfolios p JOIN vaults v ON v.vault_id=p.vault_id WHERE v.owner='b@example.com'").get();
  const envelope = JSON.parse(row.e);
  assert.equal(envelope.vaultId, row.id, 'stored under the destination vault identity');
  assert.notEqual(envelope.vaultId, JSON.parse(pkg).vault.vaultId);
  assert.equal(envelope.revision, 2);
  assert.ok(!row.e.includes('MEBL'));
});

test('plain legacy backups are recognised (to be re-encrypted locally); wrong files are refused', async () => {
  const plain = JSON.stringify({ kind: 'psx-portfolio-ledger', schemaVersion: 1, portfolio: { ...blankPortfolio(), companies: [company('LUCK')] } });
  const parsed = b.parseBackup(plain);
  assert.equal(parsed.type, 'plain');
  assert.equal(parsed.portfolio.companies[0].ticker, 'LUCK');
  for (const bad of ['not json', '{}', JSON.stringify({ kind: 'psx-research-dossier' }), JSON.stringify({ kind: 'psx-portfolio-ledger', schemaVersion: 2 }), JSON.stringify({ kind: b.BACKUP_KIND, version: 9 }), JSON.stringify({ kind: b.BACKUP_KIND, version: 1, vault: {}, portfolio: {} })])
    assert.throws(() => b.parseBackup(bad), v.VaultError, bad.slice(0, 40));
  assert.throws(() => b.parseBackup('x'.repeat(6_000_001)), (e) => e.code === 'too-large');
});

test('a tampered backup envelope is refused before anything is restored', async () => {
  const server = createVaultServer();
  const { session } = await seed(server, 'a@example.com');
  const pkg = await session.backupPackage();
  const flipped = { ...pkg, portfolio: { ...pkg.portfolio, envelope: { ...pkg.portfolio.envelope, ct: 'A' + pkg.portfolio.envelope.ct.slice(1) } } };
  await assert.rejects(b.openBackup(b.parseBackup(JSON.stringify(flipped)).backup, { password: PASSWORD }), (e) => e.code === 'tampered');
});
