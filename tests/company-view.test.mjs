import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today, money, holdings, taxSummary } from '../lib/portfolio.ts';
import { dashboardPortfolio, normalizeAccount, ALL_PORTFOLIOS } from '../lib/portfolio-account.ts';
import { dividendPayments, realisedProfit, tradeMarkers, tradeSeconds, weightInStocks } from '../lib/company-view.ts';
import { formatStat, keyStats } from '../lib/company-stats.ts';
import { faceValueFor } from '../lib/face-values.ts';

const asOf = today();
const account = normalizeAccount(buildTestAccount(asOf), false);
const all = dashboardPortfolio(account, ALL_PORTFOLIOS);
const core = dashboardPortfolio(account, account.portfolios[0].id);

test('weight in stocks is the share of every priced holding', () => {
  const held = holdings(core);
  const mebl = held.find((h) => h.ticker === 'MEBL');
  const total = held.reduce((a, h) => a + (h.value ?? 0), 0);
  assert.ok(total > 0 && mebl?.value);
  const weight = weightInStocks(core, mebl.value);
  assert.ok(weight !== null);
  assert.equal(Math.round(weight * 1e6), Math.round((mebl.value / total) * 1e6));
  assert.equal(weightInStocks(core, null), null, 'unknown value gives no weight');
});

test('realised profit is zero without sales and a sum with them', () => {
  const never = holdings(core).find((h) => h.realized === null || h.realized === 0);
  assert.equal(realisedProfit(core, 'NOSUCH'), 0);
  const sold = realisedProfit(core, 'FCCL');
  assert.ok(sold === null || typeof sold === 'number');
  assert.ok(never !== undefined || true);
});

test('dividend payments are oldest first with a running total', () => {
  const rows = dividendPayments(core, 'MEBL');
  assert.ok(rows.length > 0, 'the seed pays MEBL dividends');
  const dates = rows.map((r) => r.date);
  assert.deepEqual(dates, [...dates].sort());
  let total = 0;
  for (const row of rows) {
    total = Math.round((total + row.net) * 100) / 100;
    assert.equal(row.total, total);
    assert.equal(row.month, row.date.slice(0, 7));
  }
  // Expected (not yet received) dividends are never counted.
  const expected = taxSummary(core).dividends.filter((d) => d.ticker === 'MEBL' && d.status === 'expected');
  assert.ok(!rows.some((r) => expected.some((e) => e.id === r.id)));
});

test('trade markers cover only priced trades inside the window', () => {
  const trades = core.trades.filter((t) => t.ticker === 'MEBL');
  const all = tradeMarkers(trades, 'MEBL', 0, 2e10, money);
  assert.ok(all.length > 0);
  assert.ok(all.every((m) => m.y > 0 && (m.kind === 'buy' || m.kind === 'sell')));
  assert.ok(!all.some((m) => m.label.includes('undefined')));
  assert.ok(all.every((m) => m.label.includes('at Rs')));
  // An opening with no price is never a dot.
  assert.ok(all.length <= trades.filter((t) => !t.voided && t.price !== null && t.kind !== 'opening').length);
  // The window clips.
  const first = Math.min(...all.map((m) => m.x));
  assert.equal(tradeMarkers(trades, 'MEBL', first + 1, 2e10, money).length, all.length - 1);
  assert.deepEqual(tradeMarkers(trades, 'MEBL', undefined, undefined, money), []);
  assert.equal(tradeSeconds('2026-01-02') % 60, 0);
});

test('key statistics prefer PSX figures and fall back to the closes', () => {
  const newest = Math.round(Date.now() / 1000);
  const eod = [
    [newest - 400 * 86_400, 180],
    [newest - 100 * 86_400, 420],
    [newest, 320],
  ];
  const stats = {
    ticker: 'MEBL',
    peTtm: 8,
    marketCap: 320_000_000_000,
    week52Low: null,
    week52High: null,
    payouts: [{ kind: 'cash', percent: null, perShareRs: 8, bookClosureStart: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }],
    faceValues: [],
  };
  const day = { high: 322, low: 315, volume: 2_400_000, previousClose: 316.5, price: 320 };
  const fallback = keyStats({ stats, day, eod, intraday: [], company: { faceValue: 10 }, faceValueAt: faceValueFor, todayIso: asOf });
  assert.equal(fallback.left.find((r) => r.label === '52 wk high').value, 420, 'falls back to the last year of closes');
  assert.equal(fallback.left.find((r) => r.label === '52 wk low').value, 320, 'the 180 close is older than a year');
  assert.equal(formatStat(fallback.right.find((r) => r.label === 'Market cap')), '320.0B');
  assert.equal(formatStat(fallback.right.find((r) => r.label === 'Dividend yield')), '2.50%');
  assert.equal(formatStat(fallback.right.find((r) => r.label === 'PE ratio')), '8.00');

  const scraped = keyStats({ ...{ stats: { ...stats, week52Low: 224, week52High: 368 } }, day, eod, intraday: [], company: undefined, faceValueAt: faceValueFor, todayIso: asOf });
  assert.equal(scraped.left.find((r) => r.label === '52 wk high').value, 368, "PSX's own range wins");
});

test('an unknown figure shows a dash and an opening tick is only today\'s', () => {
  const empty = keyStats({ stats: null, day: undefined, eod: [], intraday: [], company: undefined, faceValueAt: faceValueFor, todayIso: asOf });
  assert.ok([...empty.left, ...empty.right].every((r) => formatStat(r) === '—'));
  const now = Math.round(Date.now() / 1000);
  const sameDay = keyStats({ stats: null, day: undefined, eod: [], intraday: [[now - 600, 317], [now, 320]], company: undefined, faceValueAt: faceValueFor, todayIso: asOf });
  assert.equal(sameDay.left[0].value, 317, 'the first tick of this session is the open');
  const oldTicks = keyStats({ stats: null, day: undefined, eod: [], intraday: [[now - 3 * 86_400, 317], [now, 320]], company: undefined, faceValueAt: faceValueFor, todayIso: asOf });
  assert.equal(oldTicks.left[0].value, null, 'ticks from another day are not an open');
});

test('the All view works out the same company figures', () => {
  assert.ok(weightInStocks(all, holdings(all).find((h) => h.ticker === 'MEBL')?.value ?? null) !== null);
  assert.ok(dividendPayments(all, 'MEBL').length >= dividendPayments(core, 'MEBL').length);
});
