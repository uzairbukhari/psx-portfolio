import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createD1, vaultMigrationsDir } from './helpers/d1.mjs';
import * as v from '../lib/vault-crypto.ts';
import * as api from '../lib/vault-api.ts';

const base = new URL('../', import.meta.url);
const PASSWORD = 'correct horse battery staple';
const MARKER = 'SYNTH-MARKER-ZEBRA-90210';

async function newVault(password = PASSWORD, marker = MARKER) {
  const vault = await v.createVaultKeys(password);
  const material = { ...vault.material, wrapperVersion: 1 };
  const envelope = await v.encryptPortfolio(vault.dataKey, material.vaultId, 1, 1, JSON.stringify({ companies: [], trades: [], marker }));
  return { vault, material, envelope };
}
const post = (path, method, body, extra = {}) => new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
const body = async (res) => res.json();
const expectFail = async (promise, status, code) => {
  await assert.rejects(promise, (e) => e.status === status && (code === undefined || e.code === code), `expected ${status} ${code ?? ''}`);
};

test('setup creates vault + encrypted blank portfolio atomically; second setup is refused', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  const res = await api.postVault(db, 'A@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await body(res)).revision, 1);
  const read = await body(await api.getCiphertext(db, 'a@example.com'));
  assert.equal(read.revision, 1);
  assert.deepEqual(read.envelope, a.envelope);
  const b = await newVault();
  await expectFail(api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: b.material, envelope: b.envelope })), 409, 'vault-exists');
  // The refused attempt left nothing behind.
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM vaults').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM vault_portfolios').get().n, 1);
});

test('setup rejects mismatched ids, wrong revision, and malformed bodies', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault(), b = await newVault();
  const bad = [
    { material: a.material, envelope: b.envelope },
    { material: a.material, envelope: { ...a.envelope, revision: 2 } },
    { material: a.material, envelope: { ...a.envelope, keyVersion: 2 } },
    { material: { ...a.material, formatVersion: 9 }, envelope: a.envelope },
    { material: { ...a.material, password: { ...a.material.password, kdf: { ...a.material.password.kdf, m: 8 } } }, envelope: a.envelope },
    { material: a.material },
    {},
  ];
  for (const payload of bad) await assert.rejects(api.postVault(db, 'a@example.com', post('/api/vault', 'POST', payload)), (e) => e.status === 400 || e.status === 422);
  await assert.rejects(api.postVault(db, 'a@example.com', new Request('https://app.test/api/vault', { method: 'POST', body: '[]' })), (e) => e.status === 400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM vaults').get().n, 0);
});

test('isolation: two users and a super-admin each only reach their own rows', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault(), b = await newVault(PASSWORD + '2', 'SYNTH-OTHER-MARKER');
  await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  await api.postVault(db, 'b@example.com', post('/api/vault', 'POST', { material: b.material, envelope: b.envelope }));
  const va = (await body(await api.getVault(db, 'a@example.com'))).vault;
  const vb = (await body(await api.getVault(db, 'b@example.com'))).vault;
  assert.equal(va.vaultId, a.material.vaultId);
  assert.equal(vb.vaultId, b.material.vaultId);
  assert.equal((await body(await api.getVault(db, 'admin@example.com'))).vault, null);
  await expectFail(api.getCiphertext(db, 'admin@example.com'), 404, 'no-vault');
  // B cannot overwrite A's ciphertext by presenting A's vault id: the owner comes from the session, not the body.
  const forged = await v.encryptPortfolio(b.vault.dataKey, a.material.vaultId, 1, 2, '{}');
  await expectFail(api.putCiphertext(db, 'b@example.com', post('/api/v3/portfolio', 'PUT', { envelope: forged, expectedRevision: 1 })), 409, 'conflict');
  const stillA = await body(await api.getCiphertext(db, 'a@example.com'));
  assert.deepEqual(stillA.envelope, a.envelope);
  // Same for wrappers and deletion.
  const wrap = await v.wrapWithPassword(b.vault.dataKey, b.material.vaultId, 1, PASSWORD + '3');
  await api.putVaultWrappers(db, 'b@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 1, password: wrap }));
  assert.equal((await body(await api.getVault(db, 'a@example.com'))).vault.wrapperVersion, 1);
  await api.deleteOwnVault(db, 'b@example.com', post('/api/vault', 'DELETE', { confirm: true }));
  assert.ok((await body(await api.getVault(db, 'a@example.com'))).vault);
  assert.equal((await body(await api.getVault(db, 'b@example.com'))).vault, null);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM vault_portfolios').get().n, 1);
});

test('saves: revision check, next-revision binding, conflict, and key version', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  const e2 = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 2, '{"n":2}');
  const ok = await api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: e2, expectedRevision: 1 }));
  assert.equal((await body(ok)).revision, 2);
  // Stale writer: still thinks revision is 1.
  const stale = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 2, '{"n":"stale"}');
  await expectFail(api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: stale, expectedRevision: 1 })), 409, 'conflict');
  // Envelope encrypted for the wrong revision, or the wrong key version.
  const wrongRev = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 9, '{}');
  await assert.rejects(api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: wrongRev, expectedRevision: 2 })), (e) => e.status === 400);
  const wrongKey = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 2, 3, '{}');
  await expectFail(api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: wrongKey, expectedRevision: 2 })), 409, 'conflict');
  await assert.rejects(api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: wrongRev, expectedRevision: 0 })), (e) => e.status === 400);
  const read = await body(await api.getCiphertext(db, 'a@example.com'));
  assert.equal(read.revision, 2);
  assert.equal(await v.decryptPortfolio(a.vault.dataKey, read.envelope, { vaultId: a.material.vaultId, keyVersion: 1, revision: 2 }), '{"n":2}');
});

test('concurrent saves: exactly one wins', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  const make = async (n) => post('/api/v3/portfolio', 'PUT', { envelope: await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 2, `{"n":${n}}`), expectedRevision: 1 });
  const results = await Promise.allSettled([api.putCiphertext(db, 'a@example.com', await make(1)), api.putCiphertext(db, 'a@example.com', await make(2))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1);
});

test('wrapper updates use their own version: a stale password change cannot overwrite a newer one', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  const w1 = await v.wrapWithPassword(a.vault.dataKey, a.material.vaultId, 1, PASSWORD + ' one');
  const w2 = await v.wrapWithPassword(a.vault.dataKey, a.material.vaultId, 1, PASSWORD + ' two');
  assert.equal((await body(await api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 1, password: w1 })))).wrapperVersion, 2);
  await expectFail(api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 1, password: w2 })), 409, 'wrapper-conflict');
  const stored = (await body(await api.getVault(db, 'a@example.com'))).vault;
  assert.deepEqual(stored.password, w1);
  assert.deepEqual(await v.unwrapWithPassword(stored, PASSWORD + ' one'), a.vault.dataKey);
  // Portfolio ciphertext is untouched by wrapper changes.
  assert.equal((await body(await api.getCiphertext(db, 'a@example.com'))).revision, 1);
  // Malformed and abusive wrappers, empty updates and an unknown vault.
  await assert.rejects(api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 2, password: { ...w1, kdf: { ...w1.kdf, m: 2 ** 30 } } })), (e) => e.status === 422);
  await assert.rejects(api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 2 })), (e) => e.status === 400);
  await expectFail(api.putVaultWrappers(db, 'nobody@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 1, password: w1 })), 404, 'no-vault');
  // Recovery replacement also bumps the version and leaves the password wrapper alone.
  const { wrapper } = await v.wrapWithRecovery(a.vault.dataKey, a.material.vaultId, 1);
  await api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 2, recovery: wrapper }));
  const after = (await body(await api.getVault(db, 'a@example.com'))).vault;
  assert.equal(after.wrapperVersion, 3);
  assert.deepEqual(after.password, w1);
  assert.deepEqual(after.recovery, wrapper);
  await expectFail(api.putVaultWrappers(db, 'a@example.com', post('/api/vault', 'PUT', { expectedWrapperVersion: 3, recovery: wrapper, password: { ...w1, ct: w1.ct.slice(0, -4) } })), 400);
});

test('size limits: oversize bodies are refused by bytes before parsing; an exact 4,000,000-byte plaintext fits', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  const big = new Request('https://app.test/api/vault', { method: 'POST', headers: { 'content-length': '6000001' }, body: 'x' });
  await expectFail(api.postVault(db, 'a@example.com', big), 413);
  const huge = new Request('https://app.test/api/vault', { method: 'POST', body: 'x'.repeat(6_000_001) });
  await expectFail(api.postVault(db, 'a@example.com', huge), 413);
  const full = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 1, new Uint8Array(4_000_000));
  const res = await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: full }));
  assert.equal(res.status, 201);
  // An envelope whose ciphertext exceeds the cap is rejected by validation without decrypting.
  const oversized = { ...full, ct: 'A'.repeat(v.b64uLength(4_000_100)) };
  await assert.rejects(api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: { ...oversized, revision: 2 }, expectedRevision: 1 })), (e) => e.status === 400);
});

test('nothing but ciphertext reaches storage: no synthetic marker anywhere in the raw database', async () => {
  const db = createD1(vaultMigrationsDir);
  const a = await newVault();
  await api.postVault(db, 'a@example.com', post('/api/vault', 'POST', { material: a.material, envelope: a.envelope }));
  const e2 = await v.encryptPortfolio(a.vault.dataKey, a.material.vaultId, 1, 2, JSON.stringify({ companies: [{ ticker: 'MARKERCO' }], marker: MARKER }));
  await api.putCiphertext(db, 'a@example.com', post('/api/v3/portfolio', 'PUT', { envelope: e2, expectedRevision: 1 }));
  const dump = JSON.stringify([db.sqlite.prepare('SELECT * FROM vaults').all(), db.sqlite.prepare('SELECT * FROM vault_portfolios').all()]);
  assert.ok(!dump.includes('MARKER') && !dump.includes('MARKERCO') && !dump.includes('ZEBRA'));
  assert.ok(!dump.includes(PASSWORD) && !dump.includes(a.vault.recoverySecret));
  // The wire responses carry no key that opens anything either: only wrappers and ciphertext.
  const res = JSON.stringify([await body(await api.getVault(db, 'a@example.com')), await body(await api.getCiphertext(db, 'a@example.com'))]);
  assert.ok(!res.includes(Buffer.from(a.vault.dataKey).toString('hex')) && !res.includes(v.toB64u(a.vault.dataKey)));
  // The vault database has no table that could hold private plaintext columns.
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name).sort();
  assert.deepEqual(tables, ['vault_portfolios', 'vaults']);
});

test('the retired plaintext endpoint rejects every method with upgrade-required and touches nothing', async () => {
  const source = readFileSync(new URL('app/api/portfolio/route.ts', base), 'utf8').replace(/from '@\/lib\/([\w-]+)'/g, (_, name) => `from '${new URL(`lib/${name}.ts`, base).href}'`);
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  assert.deepEqual(Object.keys(route).sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
  for (const method of Object.keys(route)) {
    const res = await route[method](new Request('https://app.test/api/portfolio', { method, body: method === 'GET' ? undefined : JSON.stringify({ portfolio: { companies: [{ ticker: MARKER }] }, revision: 0 }) }));
    assert.equal(res.status, 426);
    assert.equal((await res.json()).code, 'upgrade-required');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('the new route files take the owner only from the verified session and never import the public database', () => {
  for (const file of ['app/api/vault/route.ts', 'app/api/v3/portfolio/route.ts']) {
    const text = readFileSync(new URL(file, base), 'utf8');
    assert.ok(!/\bdb\(\)/.test(text.replace(/vaultDb\(\)/g, '')), `${file} must use vaultDb() only`);
    assert.match(text, /identity\(req(, true)?\)/);
    assert.ok(!/isSuperAdmin|requireSuperAdmin/.test(text));
  }
});
