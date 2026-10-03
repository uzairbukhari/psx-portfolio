import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../lib/vault-client.ts';
import * as v from '../lib/vault-crypto.ts';
import * as view from '../lib/portfolio-view.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { createVaultServer, memoryVaultCache } from './helpers/vault-server.mjs';

test.beforeEach(() => v.setCryptoAdapter({ randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(globalThis.crypto.subtle) }));
test.afterEach(() => v.setCryptoAdapter(null));

const company = (ticker, name = ticker, sector = '') => ({ ticker, name, sector, target: 0, approved: false, screenDate: '', note: '' });
const row = (ticker, price, date, at) => ({ ticker, price, as_of: 'x', quote_date: date, source: 'https://dps.psx.com.pk/indices/ALLSHR', fetched_at: at });
const lookup = (ticker, name, sector) => ({ ticker, state: 'resolved', company: { name, sector, sectorCode: null, securityType: 'equity', listingStatus: 'listed', faceValue: 10 } });
const unresolved = (ticker) => ({ ticker, state: 'unresolved', company: null });

function fakePublic({ rows = [], lookups = [], failMarket = false, failCompanies = false } = {}) {
  const calls = { market: [], companies: [], requested: [] };
  return {
    calls,
    market: async (t) => { calls.market.push(t); if (failMarket) throw new Error('down'); return { tickers: t, quoteRows: rows, announcements: [{ ticker: 'MEBL' }], faceValues: { MEBL: [] } }; },
    companies: async (t) => { calls.companies.push(t); if (failCompanies) throw new Error('down'); return lookups.filter((l) => t.includes(l.ticker)); },
    requestLookup: async (t) => { calls.requested.push(t); },
  };
}
async function session(server, portfolio) {
  const transport = server.as('a@example.com');
  const s = await (await c.prepareVault(transport, 'correct horse battery staple', memoryVaultCache())).finish();
  if (portfolio) await s.save(portfolio, 1);
  return s;
}

test('load overlays shared quotes without replacing a newer saved quote, and fills placeholder names', async () => {
  const server = createVaultServer();
  const saved = { price: 120, asOf: 'a', date: '2026-09-29', source: 's', fetchedAt: '2026-09-29T05:38:00Z' };
  const s = await session(server, { ...blankPortfolio(), companies: [company('MEBL', 'MEBL'), company('LUCK', 'Lucky Cement', 'Cement')], quotes: { MEBL: saved } });
  const pub = fakePublic({ rows: [row('MEBL', 100, '2026-09-28', '2026-09-28T11:00:00Z'), row('LUCK', 90, '2026-09-28', '2026-09-28T11:00:00Z'), row('OTHER', 5, '2026-09-28', '2026-09-28T11:00:00Z')], lookups: [lookup('MEBL', 'Meezan Bank', 'Bank')] });
  const out = await view.loadPortfolioView(s, pub);
  assert.equal(out.portfolio.quotes.MEBL.price, 120);
  assert.equal(out.portfolio.quotes.LUCK.price, 90);
  assert.equal(out.portfolio.quotes.OTHER, undefined, 'a cached quote for a ticker you do not hold is never injected');
  assert.equal(out.portfolio.companies[0].name, 'Meezan Bank');
  assert.equal(out.portfolio.companies[0].sector, 'Bank');
  assert.ok(Array.isArray(out.announcements));
  assert.equal(out.revision, 2);
  // Only tickers are sent out: the market call carries the tickers and nothing else of the portfolio.
  assert.deepEqual(pub.calls.market[0].sort(), ['LUCK', 'MEBL']);
  assert.deepEqual(pub.calls.companies[0], ['MEBL']);
  // The overlay is in memory only; the stored plaintext is untouched.
  assert.equal(s.portfolio.companies[0].name, 'MEBL');
});

test('load still works when public data is unavailable (offline or a hiccup)', async () => {
  const server = createVaultServer();
  const s = await session(server, { ...blankPortfolio(), companies: [company('MEBL')] });
  const out = await view.loadPortfolioView(s, fakePublic({ failMarket: true, failCompanies: true }));
  assert.equal(out.portfolio.companies[0].ticker, 'MEBL');
  assert.deepEqual(out.pendingCompanies, ['MEBL']);
  assert.deepEqual(out.announcements, []);
});

test('an empty portfolio makes no public-data request at all', async () => {
  const server = createVaultServer();
  const s = await session(server);
  const pub = fakePublic();
  await view.loadPortfolioView(s, pub);
  assert.equal(pub.calls.market.length, 0);
});

test('save: new companies take directory details, unresolved ones are kept and queued, then everything is encrypted', async () => {
  const server = createVaultServer();
  const s = await session(server);
  const pub = fakePublic({ lookups: [lookup('MEBL', 'Meezan Bank', 'Bank'), unresolved('ZZZZ')] });
  const next = { ...blankPortfolio(), companies: [company('MEBL'), company('ZZZZ')] };
  const out = await view.savePortfolioView(s, pub, next, 1);
  assert.equal(out.revision, 2);
  assert.deepEqual(out.details, [{ ticker: 'MEBL', name: 'Meezan Bank', sector: 'Bank' }]);
  assert.deepEqual(out.pendingCompanies, ['ZZZZ']);
  assert.equal(next.companies[0].name, 'Meezan Bank');
  assert.deepEqual(pub.calls.requested, [['ZZZZ']]);
  assert.ok(!JSON.stringify(server.log).includes('Meezan'));
});

test('strict Add Company: unresolved or already-held symbols are refused and nothing is saved', async () => {
  const server = createVaultServer();
  const s = await session(server, { ...blankPortfolio(), companies: [company('MEBL', 'Meezan Bank', 'Bank')] });
  const pub = fakePublic({ lookups: [unresolved('ZZZZ'), lookup('LUCK', 'Lucky Cement', 'Cement')] });
  const before = server.log.length;
  await assert.rejects(view.savePortfolioView(s, pub, { ...s.portfolio, companies: [...s.portfolio.companies, company('ZZZZ')] }, 2, ['ZZZZ']), /not available yet/);
  await assert.rejects(view.savePortfolioView(s, pub, { ...s.portfolio }, 2, ['MEBL']), /already in your portfolio/);
  await assert.rejects(view.savePortfolioView(s, pub, { ...s.portfolio }, 2, ['LUCK']), /not part of this save/);
  await assert.rejects(view.savePortfolioView(s, fakePublic({ failCompanies: true }), { ...s.portfolio, companies: [...s.portfolio.companies, company('LUCK')] }, 2, ['LUCK']), /could not be checked/);
  assert.equal(server.log.length, before, 'no save request was made');
  const ok = await view.savePortfolioView(s, pub, { ...s.portfolio, companies: [...s.portfolio.companies, company('LUCK')] }, 2, ['LUCK']);
  assert.equal(ok.revision, 3);
});

test('a tolerant save survives a failed company lookup (valid trades are never lost to metadata)', async () => {
  const server = createVaultServer();
  const s = await session(server);
  const out = await view.savePortfolioView(s, fakePublic({ failCompanies: true }), { ...blankPortfolio(), companies: [company('NEWCO')] }, 1);
  assert.equal(out.revision, 2);
  assert.deepEqual(out.pendingCompanies, ['NEWCO']);
});

test('a stale revision surfaces as ConflictError and the stored data is not changed', async () => {
  const server = createVaultServer();
  const s = await session(server, { ...blankPortfolio(), companies: [company('MEBL', 'Meezan Bank', 'Bank')] });
  await assert.rejects(view.savePortfolioView(s, fakePublic(), { ...s.portfolio, note: 'x' }, 1), c.ConflictError);
  assert.equal((await s.reload()).revision, 2);
});
