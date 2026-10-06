import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../lib/portfolio.ts';
import { accountOverview } from '../lib/account-overview.ts';

const company = (ticker, sector = 'Bank') => ({
  ticker,
  name: ticker + ' Ltd',
  sector,
  target: 0,
  approved: false,
  screenDate: '',
  note: '',
});
const trade = (id, ticker, kind, shares, price, date) => ({
  id,
  ticker,
  kind,
  shares,
  price,
  date,
  fees: 0,
  month: '',
  note: '',
});
const quote = (price) => ({
  price,
  date: '2026-10-05',
  asOf: 'test',
  source: 'https://dps.psx.com.pk/x',
  fetchedAt: '2026-10-05T06:00:00Z',
});
function ledger(over = {}) {
  return { ...blankPortfolio(), taxProfile: { filerStatus: 'filer' }, ...over };
}
const a = ledger({
  companies: [company('MEBL'), company('LUCK', 'Cement')],
  trades: [
    trade('1', 'MEBL', 'buy', 100, 100, '2025-01-10'),
    trade('2', 'LUCK', 'buy', 10, 500, '2025-02-10'),
  ],
  quotes: { MEBL: quote(150), LUCK: quote(600) },
  dividends: [
    {
      id: 'd1',
      ticker: 'MEBL',
      date: '2026-08-01',
      paymentDate: '2026-08-10',
      source: 'manual',
      grossAmount: 1000,
      note: '',
      status: 'received',
    },
  ],
});
const b = ledger({
  companies: [company('MEBL')],
  trades: [trade('1', 'MEBL', 'buy', 50, 120, '2025-03-10')],
  quotes: { MEBL: quote(150) },
});
const parts = [
  { id: 'ahl', name: 'AHL', portfolio: a },
  { id: 'fq', name: 'Finqalab', portfolio: b, locked: true },
];

test('totals add each portfolio after it is calculated on its own', () => {
  const o = accountOverview(parts, '2026-10-06');
  assert.equal(o.total.value, 100 * 150 + 10 * 600 + 50 * 150);
  assert.equal(o.total.cost, 100 * 100 + 10 * 500 + 50 * 120);
  assert.equal(o.total.gain, o.total.value - o.total.cost);
  assert.deepEqual(
    o.portfolios.map((p) => [p.name, p.value, p.locked]),
    [
      ['AHL', 21000, false],
      ['Finqalab', 7500, true],
    ],
  );
  assert.ok(
    Math.abs(o.portfolios.reduce((n, p) => n + p.share, 0) - 100) < 1e-9,
  );
  assert.equal(o.classes.length, 1);
  assert.equal(o.classes[0].key, 'stocks');
});

test('holdings merge by ticker with the portfolios that hold them, and sectors add up', () => {
  const o = accountOverview(parts, '2026-10-06');
  assert.equal(o.holdingCount, 2);
  assert.deepEqual(o.topHoldings[0].portfolios, ['AHL', 'Finqalab']);
  assert.equal(o.topHoldings[0].ticker, 'MEBL');
  assert.equal(
    o.sectors.reduce((n, s) => n + s.value, 0),
    o.total.value,
  );
});

test('income counts received dividends only, by tax year and month', () => {
  const o = accountOverview(parts, '2026-10-06');
  assert.equal(o.income.taxYear, '2026-27');
  assert.equal(o.income.received, 1000);
  assert.equal(o.income.months.length, 12);
  assert.equal(o.income.months.at(-1).month, '2026-10');
  assert.equal(o.income.months.find((m) => m.month === '2026-08').amount, 1000);
});

test('a missing price or unknown cost is reported, not shown as zero', () => {
  const missing = ledger({
    companies: [company('HUBC')],
    trades: [trade('1', 'HUBC', 'buy', 10, 100, '2025-01-01')],
  });
  const o = accountOverview(
    [...parts, { id: 'x', name: 'X', portfolio: missing }],
    '2026-10-06',
  );
  assert.ok(o.total.incomplete.length > 0);
  assert.equal(o.total.gain, null);
  assert.equal(o.returns.rate, null);
  assert.ok(o.returns.blockedBy);
});

test('combined return counts dividends as cash back', () => {
  const withIncome = accountOverview(parts, '2026-10-06');
  const noIncome = accountOverview(
    [{ id: 'ahl', name: 'AHL', portfolio: { ...a, dividends: [] } }, parts[1]],
    '2026-10-06',
  );
  assert.equal(withIncome.returns.reason, 'ok');
  assert.ok(withIncome.returns.rate > noIncome.returns.rate);
});

test('gold coins are valued, added to net worth and shown as their own class', () => {
  const coins = {
    id: 'g',
    kind: 'metal',
    name: 'Coins',
    metal: 'gold',
    karat: 24,
    note: '',
    entries: [
      {
        id: '1',
        type: 'buy',
        date: '2025-01-01',
        grams: 11.6638,
        amount: 400000,
        note: '',
      },
    ],
  };
  const rates = [
    {
      date: '2026-10-05',
      metal: 'gold',
      kind: 'local',
      pkrPerTola: 436000,
      sourceUrl: 'https://x.test',
      fetchedAt: '2026-10-05T08:00:00Z',
    },
  ];
  const withGold = [
    { ...parts[0], portfolio: { ...a, assets: [coins] } },
    parts[1],
  ];
  const o = accountOverview(withGold, '2026-10-06', { metalRates: rates });
  const stocks = accountOverview(parts, '2026-10-06').total.value;
  assert.equal(Math.round(o.total.value - stocks), 436000);
  assert.deepEqual(
    o.classes.map((c) => c.key),
    ['stocks', 'gold'],
  );
  assert.ok(Math.abs(o.classes.reduce((n, c) => n + c.share, 0) - 100) < 1e-9);
  assert.equal(o.portfolios[0].value, 21000 + 436000);
  const noRate = accountOverview(withGold, '2026-10-06');
  assert.ok(noRate.total.incomplete.some((m) => /gold rate/.test(m)));
  assert.equal(noRate.total.gain, null);
});
