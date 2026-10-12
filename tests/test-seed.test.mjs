import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount, buildTestBackup } from '../lib/test-seed/account.ts';
import { TEST_COMPANIES, TEST_FUNDS } from '../lib/test-seed/universe.ts';
import { normalizeAccount, MAX_PORTFOLIOS } from '../lib/portfolio-account.ts';
import { validate, today, holdings, NOTIFICATION_KINDS } from '../lib/portfolio.ts';
import { parseBackup } from '../lib/vault-backup.ts';
import { PAK_QATAR_SUBFUNDS } from '../lib/plans.ts';

const DAYS = [today(), '2026-01-31', '2026-03-01'].filter((d) => d <= today());
const account = () => JSON.parse(JSON.stringify(buildTestAccount(today())));
const all = (pick) => account().portfolios.flatMap((p) => pick(p.portfolio) ?? []);

test('the test account passes strict validation and is dated relative to today', () => {
  for (const day of DAYS) {
    const a = JSON.parse(JSON.stringify(buildTestAccount(day)));
    assert.equal(a.portfolios.length, MAX_PORTFOLIOS);
    for (const p of a.portfolios) validate(p.portfolio);
    assert.doesNotThrow(() => normalizeAccount(a, true), day);
  }
});

test('the backup file restores through parseBackup as a whole account', () => {
  const parsed = parseBackup(JSON.stringify(buildTestBackup(today())));
  assert.equal(parsed.type, 'account');
  assert.equal(parsed.account.portfolios.length, MAX_PORTFOLIOS);
});

test('every portfolio is used: real holdings, a fully sold company, an empty and locked one', () => {
  const [core, fq, savings, empty] = account().portfolios;
  assert.ok(holdings(core.portfolio).filter((h) => h.shares > 0).length >= 10);
  assert.ok(holdings(fq.portfolio).filter((h) => h.shares > 0).length >= 3);
  assert.ok(core.portfolio.trades.some((t) => t.ticker === 'HUBC' && t.kind === 'sell'));
  assert.ok(!holdings(core.portfolio).some((h) => h.ticker === 'HUBC' && h.shares > 0));
  assert.equal(savings.portfolio.trades.length, 0);
  assert.equal(empty.locked, true);
  assert.equal(empty.portfolio.trades.length, 0);
  assert.equal(core.portfolio.taxProfile.filerStatus, 'filer');
  assert.equal(fq.portfolio.taxProfile.filerStatus, 'non-filer');
});

// When a feature adds a new kind of record, this fails until lib/test-seed/account.ts exercises it.
test('every enum value the app knows about appears in the seed', () => {
  const has = (list, fn, label) => assert.ok(list.some(fn), `seed is missing: ${label}`);
  const trades = all((p) => p.trades);
  for (const kind of ['opening', 'buy', 'sell', 'adjustment']) has(trades, (t) => t.kind === kind, `trade kind ${kind}`);
  for (const source of ['manual', 'finqalab', 'ahl', 'ipo', 'broker']) has(trades, (t) => (t.source ?? 'manual') === source, `trade source ${source}`);
  has(trades, (t) => t.voided, 'voided trade');
  has(trades, (t) => t.inferred, 'inferred acquisition');
  has(trades, (t) => t.opening === undefined && t.kind === 'opening' && t.price === null, 'opening with unknown cost');
  has(trades, (t) => t.dateCertainty === 'inferred', 'inferred date');
  has(all((p) => p.stockSplits), (s) => !s.voided, 'stock split');

  const dividends = all((p) => p.dividends);
  for (const source of ['manual', 'import', 'auto']) has(dividends, (d) => d.source === source, `dividend source ${source}`);
  has(dividends, (d) => d.source === 'auto' && d.status === 'expected', 'expected auto dividend');
  has(dividends, (d) => d.source === 'auto' && d.status === 'received' && d.paymentDateEstimated, 'estimated payment date');
  has(dividends, (d) => d.paymentDateUnknown, 'payment date unknown');
  has(dividends, (d) => d.voided, 'voided dividend');
  has(dividends, (d) => d.entitlement?.rateSource === 'percent-of-face-value', 'percent-of-face-value payout');
  has(dividends, (d) => d.entitlement?.rateSource === 'rupees', 'rupee payout');
  has(dividends, (d) => d.entitlement?.certain === false, 'uncertain entitlement');

  const notifications = all((p) => p.notifications);
  for (const kind of NOTIFICATION_KINDS) has(notifications, (n) => n.kind === kind, `notification ${kind}`);
  has(notifications, (n) => n.read, 'read notification');
  has(notifications, (n) => !n.read, 'unread notification');
  has(notifications, (n) => n.clearedAt, 'cleared notification');

  const research = all((p) => p.research);
  for (const status of ['Queue', 'Researching', 'Complete', 'Update needed']) has(research, (r) => r.status === status, `research ${status}`);

  const assets = all((p) => p.assets);
  const metals = assets.filter((a) => a.kind === 'metal');
  for (const metal of ['gold', 'silver']) has(metals, (a) => a.metal === metal, metal);
  for (const karat of [24, 22]) has(metals, (a) => a.karat === karat, `${karat}k`);
  const metalEntries = metals.flatMap((a) => a.entries);
  for (const type of ['opening', 'buy', 'sell']) has(metalEntries, (e) => e.type === type, `metal entry ${type}`);
  has(metalEntries, (e) => e.amount === null, 'metal opening with unknown cost');
  has(metalEntries, (e) => e.form === 'coin', 'coin');
  has(metalEntries, (e) => e.form === 'bar', 'bar');

  const plans = assets.filter((a) => a.kind === 'plan');
  has(plans, (a) => a.provider === 'pak-qatar-mbp' && PAK_QATAR_SUBFUNDS.some((f) => f.id === a.subFund), 'Pak-Qatar plan with sub-fund');
  has(plans, (a) => a.provider === 'other', 'other plan');
  has(plans, (a) => a.closed, 'closed plan');
  has(plans, (a) => a.rules.some((r) => r.skipped.length), 'plan rule with a skipped month');
  has(plans, (a) => a.valuations.length, 'plan valuation');
  const planEntries = plans.flatMap((a) => a.entries);
  for (const type of ['contribution', 'redeem']) has(planEntries, (e) => e.type === type, `plan entry ${type}`);
  has(planEntries, (e) => e.load, 'plan load');
  has(planEntries, (e) => e.recurringId, 'plan entry from a rule');

  const funds = assets.filter((a) => a.kind === 'fund');
  for (const mode of ['reinvest', 'cash']) has(funds, (a) => a.payoutMode === mode, `payout mode ${mode}`);
  has(funds, (a) => a.closed, 'closed fund');
  has(funds, (a) => a.manualNavs.length, 'manual NAV');
  has(funds, (a) => a.rules.length, 'fund rule');
  const fundEntries = funds.flatMap((a) => a.entries);
  for (const type of ['opening', 'buy', 'redeem', 'dividend', 'reinvest']) has(fundEntries, (e) => e.type === type, `fund entry ${type}`);
  has(fundEntries, (e) => e.source === 'auto' && e.estimated, 'automatic estimated fund payout');
  has(fundEntries, (e) => e.amount === null, 'fund opening with unknown cost');
  has(fundEntries, (e) => e.recurringId, 'fund entry from a rule');

  const core = account().portfolios[0].portfolio;
  assert.ok(core.monthlyPicksShortlist.length && core.monthlyPicksList.length, 'Monthly Picks shortlist and list');
  assert.ok(core.aiReview && core.researchSettings && core.brokerFormats.length && core.brokerFileHashes.length);
  assert.ok(Object.keys(core.budgets).length >= 12);
});

test('every fund and company the account uses exists in the shared universe', () => {
  const tickers = new Set(TEST_COMPANIES.map((c) => c.ticker));
  const ids = new Set(TEST_FUNDS.map((f) => f.mufapId));
  for (const p of account().portfolios) {
    for (const c of p.portfolio.companies) assert.ok(tickers.has(c.ticker), c.ticker);
    for (const a of p.portfolio.assets ?? []) if (a.kind === 'fund') assert.ok(ids.has(a.mufapId), a.mufapId);
  }
});

test('public fixtures build for every shared table, deterministically, and the gap set stays small', async () => {
  const { buildPublicFixtureSql } = await import('../lib/test-seed/public-fixtures.ts');
  const now = new Date('2026-10-12T00:00:00Z');
  const all = buildPublicFixtureSql('2026-10-12', 'all', now);
  assert.deepEqual(all, buildPublicFixtureSql('2026-10-12', 'all', now));
  for (const table of ['security_catalog', 'quote_refreshes', 'price_history', 'company_facts', 'fund_catalog', 'fund_navs', 'fund_payouts', 'metal_rates', 'plan_navs', 'dividend_announcements', 'ipo_offers', 'user_roles'])
    assert.ok(all.some((s) => s.includes(`INTO ${table} `)), table);
  const gaps = buildPublicFixtureSql('2026-10-12', 'gaps', now);
  assert.ok(gaps.every((s) => /INTO (fund_catalog|tracked_funds|fund_navs|fund_payouts|user_roles) /.test(s)));
  assert.ok(gaps.filter((s) => s.startsWith('INSERT OR REPLACE')).every((s) => s.includes('user_roles')), 'gaps never overwrite scraped rows');
});

test('fixture SQL runs against the real migrations', async () => {
  const { buildPublicFixtureSql } = await import('../lib/test-seed/public-fixtures.ts');
  const { createD1 } = await import('./helpers/d1.mjs');
  const db = createD1();
  for (const s of buildPublicFixtureSql(today(), 'all')) db.sqlite.exec(s);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM security_catalog').get().n, TEST_COMPANIES.length);
  assert.equal(db.sqlite.prepare("SELECT role FROM user_roles WHERE email='claude-test@sipwise.test'").get().role, 'super_admin');
});

test('seeding a vault in-process leaves ciphertext only and opens with the test password', async () => {
  const { createVaultServer } = await import('./helpers/vault-server.mjs');
  const { seedTestVault } = await import('../lib/test-seed/seed-vault.ts');
  const { loadVaultStatus, unlockVault } = await import('../lib/vault-client.ts');
  const { TEST_ACCOUNT_EMAIL, TEST_VAULT_PASSWORD } = await import('../lib/test-account.ts');
  const server = createVaultServer();
  const transport = server.as(TEST_ACCOUNT_EMAIL);
  const first = await seedTestVault(transport, today());
  assert.equal(first.portfolios.length, 4);
  // Re-seeding resets to the same state instead of failing or stacking.
  const second = await seedTestVault(transport, today());
  assert.equal(second.revision, 2);
  const status = await loadVaultStatus(transport);
  assert.equal(status.state, 'locked');
  const session = await unlockVault(transport, status, { password: TEST_VAULT_PASSWORD });
  assert.equal(session.account.portfolios.length, 4);
  const stored = JSON.stringify(server.log.map((l) => l.body ?? ''));
  assert.ok(!stored.includes('MEBL') && !stored.includes('Meezan'), 'the server must only see ciphertext');
});

test('staging gap seeding is batched and refuses the production database', async () => {
  const { seedStagingPublic } = await import('../scripts/seed-staging-public.mjs');
  const { assertStagingDatabase, PROD_DATABASE_ID } = await import('../scripts/d1-rest.mjs');
  const sent = [];
  const count = await seedStagingPublic(async (sql) => void sent.push(sql), today());
  assert.ok(count > 100);
  assert.equal(sent.join('\n').split('\n').length, count);
  assert.ok(sent.every((sql) => sql.split('\n').length <= 40));
  assert.ok(!sent.join('').includes('INTO quote_refreshes'), 'never touches what the real scrapers fill');
  assert.throws(() => assertStagingDatabase(PROD_DATABASE_ID), /production/);
});
