import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankPortfolio, holdings } from '../lib/portfolio.ts';
import { accountFromPortfolio, accountActivity, consolidatedAccount, importMatches, normalizeAccount, portfolioAt, removePortfolio, renamePortfolio, replacePortfolio } from '../lib/portfolio-account.ts';
import { loadAccountView, savePortfolioView } from '../lib/portfolio-view.ts';
import { openAccountBackup, parseBackup } from '../lib/vault-backup.ts';
import * as c from '../lib/vault-client.ts';
import * as v from '../lib/vault-crypto.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';

const PASSWORD = 'correct horse battery staple';
const company = (ticker = 'MEBL') => ({ ticker, name: 'Meezan Bank', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' });
const trade = (id, kind, shares, price, date = '2026-09-10') => ({ id, ticker: 'MEBL', kind, shares, price, date, fees: 0, month: '', note: '' });
function ledger(price = 100) {
  return { ...blankPortfolio(), companies: [company()], trades: [trade('buy', 'buy', 10, price)], quotes: { MEBL: { price: 300, date: '2026-10-05', asOf: 'test', source: 'https://dps.psx.com.pk/company/MEBL', fetchedAt: '2026-10-05T06:00:00Z' } }, taxProfile: { filerStatus: 'filer' } };
}
function account(a = ledger(), b = ledger(200)) { return normalizeAccount({ ...accountFromPortfolio(a), portfolios: [{ id: 'ahl', name: 'AHL', portfolio: a }, { id: 'finqalab', name: 'Finqalab', portfolio: b }] }); }
const publicData = { market: async () => ({ quoteRows: [], announcements: [], faceValues: {} }), companies: async () => [], requestLookup: async () => {} };
async function seed() {
  const server = createVaultServer(); const transport = server.as('account@example.test');
  const session = await (await c.prepareVault(transport, PASSWORD, memoryVaultCache())).finish();
  return { session, server, transport };
}
test.beforeEach(() => v.setCryptoAdapter({ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(crypto.subtle) }));
test.afterEach(() => v.setCryptoAdapter(null));

test('legacy migration preserves every record, setting and identity without assigning brokers', () => {
  const original = { ...ledger(), brokerFileHashes: ['a'.repeat(64)], budgets: { '2026-10': 15000 }, monthlyPicksShortlist: ['MEBL'] };
  const next = normalizeAccount(original);
  assert.equal(next.portfolios[0].id, 'default'); assert.equal(next.portfolios[0].name, 'My Portfolio');
  assert.deepEqual(next.portfolios[0].portfolio, original);
  assert.throws(() => normalizeAccount({ ...next, version: 99 }), /Update/);
});

test('cost basis and sales are isolated even when transaction IDs and tickers overlap', () => {
  const a = ledger(100); a.trades.push(trade('sell', 'sell', 5, 250, '2026-09-20'));
  const b = ledger(200);
  const out = consolidatedAccount(account(a, b));
  assert.equal(holdings(a)[0].average, 100); assert.equal(holdings(b)[0].average, 200);
  assert.equal(out.positions[0].shares, 15); assert.equal(out.positions[0].cost, 2500);
  assert.equal(out.summary.value, 4500); assert.equal(out.summary.gain, 2000);
  assert.equal(out.positions[0].portfolios.length, 2); assert.equal(out.tax.realizedGain, 750);
  const oversell = structuredClone(a); oversell.trades.push(trade('oversell', 'sell', 6, 300, '2026-09-21'));
  assert.throws(() => normalizeAccount({ ...account(a, b), portfolios: [{ id: 'ahl', name: 'AHL', portfolio: oversell }, { id: 'finqalab', name: 'Finqalab', portfolio: b }] }), /exceeds/);
});

test('unknown costs, missing quotes and splits stay incomplete after consolidation', () => {
  const a = ledger(); a.trades[0] = trade('opening', 'opening', 10, null);
  const b = ledger(); b.stockSplits = [{ id: 'split', ticker: 'MEBL', date: '2026-10-05', oldShares: 1, newShares: 2, note: '' }]; b.quotes.MEBL.date = '2026-10-04';
  const out = consolidatedAccount(account(a, b));
  assert.equal(out.summary.cost, null); assert.equal(out.summary.gain, null);
  assert.equal(out.positions[0].value, null); assert.equal(out.summary.value, 3000);
  assert.deepEqual(out.summary.missingPrice, ['MEBL']); assert.deepEqual(out.summary.unknownCost, ['MEBL']);
  assert.equal(out.positions[0].shares, 30);
});

test('dividend income excludes expected payouts; activity and notifications retain portfolio ownership', () => {
  const a = ledger(); a.dividends = [{ id: 'same-id', ticker: 'MEBL', date: '2026-10-05', source: 'manual', perShare: 20, grossAmount: 200, note: '' }];
  const b = ledger(); b.dividends = [{ id: 'same-id', ticker: 'MEBL', date: '2026-10-05', source: 'auto', externalId: 'auto-test', grossAmount: 200, perShare: 20, status: 'expected', note: '' }];
  const all = account(a, b); const out = consolidatedAccount(all);
  assert.equal(out.tax.receivedDividends, 200); assert.equal(out.tax.expectedDividends, 1);
  assert.equal(new Set(accountActivity(all).map((e) => `${e.portfolioId}:${e.kind}:${e.id}`)).size, 4);
});

test('management rejects duplicate names, invalid IDs and deleting financial history', () => {
  const all = account(); assert.throws(() => renamePortfolio(all, 'ahl', 'finqalab'), /unique/);
  assert.throws(() => removePortfolio(all, 'ahl'), /financial records/);
  const withEmpty = replacePortfolio(all, blankPortfolio(), { id: 'new', name: 'Other' });
  assert.equal(removePortfolio(withEmpty, 'new').portfolios.length, 2);
  assert.throws(() => removePortfolio(accountFromPortfolio(), 'default'), /at least one|default/);
  assert.throws(() => normalizeAccount({ ...all, portfolios: [{ ...all.portfolios[0], id: 'all' }] }), /identifier/);
});

test('cross-portfolio import matching uses durable broker identities and hashes, not lookalike manual fills', () => {
  const all = account(); all.portfolios[0].portfolio.trades[0] = { ...all.portfolios[0].portfolio.trades[0], source: 'ahl', externalId: 'voucher-1' };
  all.portfolios[0].portfolio.brokerFileHashes = ['hash'];
  const incoming = structuredClone(all.portfolios[1].portfolio);
  assert.equal(importMatches(all, 'finqalab', incoming).length, 0);
  incoming.trades.push({ ...trade('other', 'buy', 10, 100), source: 'ahl', externalId: 'voucher-1' });
  assert.deepEqual(importMatches(all, 'finqalab', incoming).map((e) => e.name), ['AHL']);
  assert.equal(importMatches(all, 'ahl', incoming, 'hash').length, 0);
  assert.equal(importMatches(all, 'finqalab', blankPortfolio(), 'hash').length, 1);
});

test('collection saves preserve other portfolios, and stale-device writes cannot overwrite them', async () => {
  const { session, transport, server } = await seed(); await session.saveAccount(account(), 1);
  const other = await c.unlockVault(transport, await c.loadVaultStatus(transport), { password: PASSWORD });
  const changed = structuredClone(session.portfolioFor({ id: 'ahl' })); changed.budgets['2026-10'] = 12345;
  await savePortfolioView(session, publicData, changed, 2, [], { id: 'ahl' });
  assert.deepEqual(session.portfolioFor({ id: 'finqalab' }), ledger(200));
  await assert.rejects(other.save(ledger(250), 2, { id: 'finqalab' }), c.ConflictError);
  await other.reload(); await other.save(ledger(250), 3, { id: 'finqalab' });
  await session.reload(); assert.equal(session.portfolioFor({ id: 'ahl' }).budgets['2026-10'], 12345);
  assert.ok(!JSON.stringify(server.log).includes('Finqalab')); assert.ok(!JSON.stringify(server.log).includes('12345'));
});

test('new import destination exists only after its atomic accepted save; backup restores every portfolio', async () => {
  const { session } = await seed(); const before = session.revision;
  const draft = { id: 'draft', name: 'Finqalab' };
  assert.equal(portfolioAt(session.account, draft).trades.length, 0);
  assert.equal(session.account.portfolios.length, 1); assert.equal(session.revision, before);
  await session.save(ledger(), before, draft); assert.equal(session.account.portfolios.length, 2);
  const backup = await session.backupPackage(); const restored = await openAccountBackup(backup, { password: PASSWORD });
  assert.deepEqual(restored, session.account);
  const readable = parseBackup(JSON.stringify({ kind: 'sipwise-portfolio-account-backup', schemaVersion: 1, account: restored }));
  assert.equal(readable.type, 'account'); assert.deepEqual(readable.account, restored);
});

test('union public lookup contains only tickers and overlays each portfolio independently', async () => {
  const { session } = await seed(); await session.saveAccount(account(), 1);
  const calls = [];
  const out = await loadAccountView(session, { ...publicData, market: async (tickers) => { calls.push(tickers); return { quoteRows: [], announcements: [], faceValues: {} }; } });
  assert.deepEqual(calls, [['MEBL']]); assert.equal(out.account.portfolios.length, 2);
  assert.equal(out.account.portfolios[0].portfolio.trades[0].price, 100); assert.equal(out.account.portfolios[1].portfolio.trades[0].price, 200);
});

test('offline collection reads preserve every ledger and lock clears the account', async () => {
  const { session, server } = await seed(); await session.saveAccount(account(), 1);
  server.state.offline = true;
  const out = await session.reload({ id: 'finqalab' }); assert.equal(out.account.portfolios.length, 2); assert.equal(out.portfolio.trades[0].price, 200);
  await assert.rejects(session.save(ledger(), 2, { id: 'ahl' }), (e) => c.isOffline(e));
  session.lock(); assert.equal(session.account.portfolios.length, 1); assert.equal(session.portfolio.trades.length, 0); assert.equal(session.revision, 0);
});

test('old web/mobile clients are refused before any collection read or write', () => {
  const v2 = readFileSync(new URL('../app/api/v2/portfolio/route.ts', import.meta.url), 'utf8');
  assert.match(v2, /GET = \(\) => upgradeRequired/); assert.match(v2, /PUT = \(\) => upgradeRequired/);
  for (const file of ['../app/vault-transport.ts', '../mobile/src/vault/transport.ts']) assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /\/api\/v3\/portfolio/);
});
