import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from '../lib/vault-client.ts';
import * as v from '../lib/vault-crypto.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (['node_modules', '.next', 'dist', '.wrangler'].includes(name)) return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const read = (path) => readFileSync(path, 'utf8');

// Files that may legitimately name the legacy plaintext tables: deletion and reset tooling, the schema itself.
const LEGACY_ALLOWED = new Set([
  'db/schema.ts',
  'lib/account-deletion.ts',
  'lib/user-data-reset.ts',
]);

test('no server, worker or scraper code reads or writes the legacy plaintext portfolio table', () => {
  const files = ['app/api', 'lib', 'workers', 'scripts'].flatMap((dir) => walk(join(root, dir))).filter((f) => /\.(ts|tsx|mjs)$/.test(f));
  for (const file of files) {
    const rel = relative(root, file);
    if (LEGACY_ALLOWED.has(rel) || rel.startsWith('scripts/reset-')) continue;
    const text = read(file);
    assert.ok(!/(FROM|INTO|UPDATE|JOIN)\s+portfolios\b/i.test(text), `${rel} touches the portfolios table`);
    assert.ok(!/(FROM|INTO|UPDATE|JOIN)\s+(ai_reviews|monthly_recommendations|recommendation_attempts)\b/i.test(text), `${rel} touches a legacy private table`);
  }
});

test('only the vault routes are bound to the private database, and no Worker or scraper has it', () => {
  const usesVault = ['app', 'lib', 'workers', 'scripts'].flatMap((dir) => walk(join(root, dir)))
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
    .filter((f) => /\.VAULT_DB|vaultDb\(/.test(read(f)))
    .map((f) => relative(root, f))
    .sort();
  const allowed = ['app/api/me/route.ts', 'app/api/v3/portfolio/route.ts', 'app/api/vault/route.ts', 'lib/server.ts'];
  assert.deepEqual(usesVault, allowed);
  assert.ok(!/VAULT/.test(read(join(root, 'workers/quote-refresh/wrangler.jsonc'))), 'the cron Worker must not bind the vault database');
  assert.ok(!/\.VAULT_DB|VAULT_DB\s*[?:]/.test(read(join(root, 'workers/quote-refresh/src/index.ts'))));
});

test('the API surface keeps the legacy portfolio endpoint closed', () => {
  const route = read(join(root, 'app/api/portfolio/route.ts'));
  assert.ok(!/db\(\)|vaultDb|prepare\(/.test(route));
  assert.match(route, /upgradeRequired/);
  const v2 = read(join(root, 'app/api/v2/portfolio/route.ts'));
  assert.match(v2, /upgradeRequired/);
  assert.ok(!/vaultDb|putCiphertext/.test(v2));
});

test.beforeEach(() => v.setCryptoAdapter({ randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(globalThis.crypto.subtle) }));
test.afterEach(() => v.setCryptoAdapter(null));

test('markers in every private field never reach the server: not in requests, not in stored rows', async () => {
  const MARKERS = ['MRKTICKER', 'MRKNOTE-ALPHA', 'MRKBUDGET-777123', 'MRKSHORTLIST', 'MRKDIVIDEND-NOTE', 'MRKCOMPANY-NAME'];
  const server = createVaultServer();
  const transport = server.as('marker@example.com');
  const session = await (await c.prepareVault(transport, 'correct horse battery staple', memoryVaultCache())).finish();
  const portfolio = {
    ...blankPortfolio(),
    companies: [{ ticker: MARKERS[0], name: MARKERS[5], sector: 'X', target: 10, approved: true, screenDate: '2026-01-01', note: MARKERS[1] }],
    trades: [{ id: 't1', ticker: MARKERS[0], kind: 'buy', date: '2026-01-02', shares: 123457, price: 98.76, fees: 1, month: '2026-01', note: MARKERS[1] }],
    budgets: { '2026-10': 777123 },
    monthlyPicksShortlist: [MARKERS[0]],
    dividends: [{ id: 'd1', ticker: MARKERS[0], date: '2026-02-01', source: 'manual', perShare: 3, grossAmount: 370371, taxWithheld: 0, status: 'received', note: MARKERS[4] }],
  };
  await session.save(portfolio, 1);
  const dump = JSON.stringify([
    server.log,
    server.db.sqlite.prepare('SELECT * FROM vaults').all(),
    server.db.sqlite.prepare('SELECT * FROM vault_portfolios').all(),
  ]);
  for (const marker of [...MARKERS, '123457', '98.76', '370371', '777123']) assert.ok(!dump.includes(marker), `${marker} reached the server`);
  // And the data does round-trip for the owner, so the absence above is encryption, not loss.
  const status = await c.loadVaultStatus(transport, memoryVaultCache());
  assert.equal(status.state, 'locked');
  const reopened = await c.unlockVault(transport, status, { password: 'correct horse battery staple' }, memoryVaultCache());
  assert.equal(reopened.portfolio.companies[0].ticker, MARKERS[0]);
  assert.equal(reopened.portfolio.budgets['2026-10'], 777123);
});

test('the gold and silver rate route takes no input and no asset field is ever sent to the server', () => {
  const route = read(join(root, 'app/api/public-data/metals/route.ts'));
  assert.ok(!/searchParams|req\.json|request\.json/.test(route), 'the metals route must not read query or body input');
  const store = read(join(root, 'lib/metal-rates-store.ts'));
  assert.ok(!/\.assets|grams|entries/.test(store), 'the rate store must know nothing about holdings');
  const client = read(join(root, 'lib/public-data-client.ts'));
  assert.ok(/call<\{ rates: MetalRateRow\[\] \}>\('\/api\/public-data\/metals'\)/.test(client), 'the rates call carries no parameters');
});
