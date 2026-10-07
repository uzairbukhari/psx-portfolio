import test from 'node:test';
import assert from 'node:assert/strict';
import { reportMode, fundReport, metalReport, rateHistory } from '../lib/asset-reports.ts';

const fund = (id, entries) => ({ id, kind: 'fund', name: id, mufapId: id, amc: '', fundName: id, category: '', note: '', entries, manualNavs: [{ id: 'm', date: '2026-10-01', nav: 120 }], rules: [] });
const buy = (id, date, units, amount) => ({ id, date, type: 'buy', units, amount, note: '' });
const gold = (entries) => ({ id: 'g', kind: 'metal', name: 'Gold', metal: 'gold', karat: 24, note: '', entries });

test('mode only switches for pure fund or metal portfolios', () => {
  const f = fund('a', []);
  assert.equal(reportMode({ trades: [], assets: [f] }), 'savings');
  assert.equal(reportMode({ trades: [], assets: [gold([])] }), 'metal');
  assert.equal(reportMode({ trades: [], assets: [f, gold([])] }), 'stocks');
  assert.equal(reportMode({ trades: [{}], assets: [f] }), 'stocks');
  assert.equal(reportMode({ trades: [{ voided: true }], assets: [f] }), 'savings');
  assert.equal(reportMode({ trades: [], assets: [] }), 'stocks');
});

test('fund report fills months and totals purchases per fund', () => {
  const r = fundReport([fund('a', [buy('1', '2026-08-05', 10, 1000), buy('2', '2026-10-05', 10, 1100)]), fund('b', [buy('3', '2026-08-06', 5, 500)])], [], '2026-10-07');
  assert.deepEqual(r.monthly.map((m) => [m.month, m.invested, m.cumulative]), [['2026-08', 1500, 1500], ['2026-09', 0, 1500], ['2026-10', 1100, 2600]]);
  assert.equal(r.invested, 2600);
  assert.equal(r.value, 3000);
  assert.equal(r.gain, 400);
});

test('metal report: average cost per tola and one rate per day', () => {
  const rates = [
    { date: '2026-10-01', metal: 'gold', kind: 'international', pkrPerTola: 400000 },
    { date: '2026-10-01', metal: 'gold', kind: 'local', pkrPerTola: 410000 },
    { date: '2026-10-02', metal: 'gold', kind: 'international', pkrPerTola: 405000 },
  ];
  assert.deepEqual(rateHistory(rates, 'gold').map((p) => [p.date, p.rate]), [['2026-10-01', 410000], ['2026-10-02', 405000]]);
  const r = metalReport([gold([{ id: '1', date: '2026-09-01', type: 'buy', grams: 11.6638, amount: 350000, note: '' }])], 'gold', rates, '2026-10-07');
  assert.equal(Math.round(r.averageCostPerTola), 350000);
  assert.equal(r.latest.rate, 405000);
});

import { backfillRows, parseYahooChart } from '../lib/metal-history.ts';

test('backfill converts world prices with the latest dollar rate and skips empty days', () => {
  const day = (d) => Date.parse(`${d}T12:00:00Z`) / 1000;
  const gold = parseYahooChart({ chart: { result: [{ timestamp: [day('2026-01-02'), day('2026-01-05'), day('2026-01-06')], indicators: { quote: [{ close: [2000, null, 2100] }] } }] } });
  assert.deepEqual(gold.map((g) => g.date), ['2026-01-02', '2026-01-06']);
  const rows = backfillRows('gold', gold, [{ date: '2026-01-01', close: 280 }, { date: '2026-01-05', close: 282 }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pkrPerTola, Math.round((2000 * 280 * 11.6638) / 31.1035));
  assert.equal(rows[1].pkrPerTola, Math.round((2100 * 282 * 11.6638) / 31.1035));
  assert.throws(() => parseYahooChart({}));
});

import { planReport } from '../lib/asset-reports.ts';
test('plan report: savings-only mode and paid in against value', () => {
  const plan = { id: 'p', kind: 'plan', name: 'MBP', provider: 'other', note: '', entries: [{ id: '1', date: '2026-08-10', type: 'contribution', amount: 50000, note: '' }, { id: '2', date: '2026-09-10', type: 'contribution', amount: 10000, note: '' }], valuations: [{ id: 'v', date: '2026-09-30', value: 62000, note: '' }], rules: [] };
  assert.equal(reportMode({ trades: [], assets: [plan] }), 'savings');
  assert.equal(reportMode({ trades: [], assets: [plan, fund('a', [])] }), 'savings');
  const r = planReport([plan], [], '2026-10-07');
  assert.deepEqual(r.series.map((s) => [s.month, s.paidIn]), [['2026-08', 50000], ['2026-09', 60000], ['2026-10', 60000]]);
  assert.equal(r.value, 62000);
  assert.equal(r.gain, 2000);
});
