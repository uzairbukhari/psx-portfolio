// Review harness (audit evidence only, not app code). Compares the mobile Holdings hero
// (mobile/src/data/derive.ts#totals) with the web value card formula (app/portfolio.tsx) and the
// shared report (lib/portfolio-reports.ts) on illustrative fixtures. Since Phase 1.1 both clients
// use lib/portfolio.ts#portfolioSummary, so F1, F4 and F5 assert the fixed (shared) behaviour.
// Run: node --test --experimental-strip-types docs/reviews/2026-10-02-sipwise-mobile/harness/parity-fixtures.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, holdings, portfolioSummary, round } from '../../../../lib/portfolio.ts';
import { portfolioReport } from '../../../../lib/portfolio-reports.ts';
import { safeHoldings, totals } from '../../../../mobile/src/data/derive.ts';
import { buildPlan } from '../../../../mobile/src/data/sip.ts';

const co = (ticker, target = 0) => ({ ticker, name: ticker, sector: 'Others', target, approved: true, screenDate: '2026-09-01', note: '' });
const q = (price, date = '2026-09-30') => ({ price, date, asOf: date, source: '', fetchedAt: '' });

/** Web value card (app/portfolio.tsx): the shared summary over the same holdings. */
function web(p) {
  const { value, cost, gain } = portfolioSummary(holdings(p));
  return { value, cost, gain };
}
const mobile = (p) => totals(safeHoldings(p).held);

function base() {
  const p = blankPortfolio();
  p.companies = [co('AAA')];
  p.trades = [
    { id: 't1', ticker: 'AAA', kind: 'buy', date: '2026-01-10', shares: 100, price: 50, fees: 50, month: '2026-01', note: '' },
    { id: 't2', ticker: 'AAA', kind: 'sell', date: '2026-03-10', shares: 40, price: 60, fees: 20, month: '', note: '' },
  ];
  p.quotes = { AAA: q(55) };
  return p;
}

test('F1 buy/sell with fees: web and mobile agree on unrealised gain; it excludes realised gain and is labelled so', () => {
  const p = base();
  const w = web(p), m = mobile(p);
  assert.deepEqual([w.value, w.cost, w.gain], [3300, 3030, 270]);
  assert.deepEqual([m.value, m.cost, m.gain], [3300, 3030, 270]);
  const realized = holdings(p)[0].realized;
  assert.equal(realized, 360); // 40 x (60 - 50.5) - 20
  const r = portfolioReport(p).summary;
  console.log('F1 report', { totalGain: r.totalGain, grandTotalReturn: r.grandTotalReturn });
  assert.notEqual(m.gain, round(m.gain + (realized ?? 0)), 'unrealised gain excludes realised gain of 360; mobile shows it as "Unrealised gain on current holdings" and total return in Reports');
  assert.deepEqual(m, portfolioSummary(holdings(p)));
});

test('F2 received dividend is excluded from both hero figures', () => {
  const p = base();
  p.dividends = [{ id: 'd1', ticker: 'AAA', date: '2026-02-01', source: 'manual', perShare: 5, grossAmount: 500, note: '' }];
  assert.equal(mobile(p).gain, 270);
  assert.equal(web(p).gain, 270);
  console.log('F2 report', portfolioReport(p).summary.grandTotalReturn);
});

test('F3 split before trade on same date, quote must be on/after split', () => {
  const p = base();
  p.stockSplits = [{ id: 's1', ticker: 'AAA', date: '2026-04-01', oldShares: 1, newShares: 2, note: '' }];
  p.quotes.AAA = q(55, '2026-03-31');
  const h = holdings(p)[0];
  assert.equal(h.shares, 120);
  assert.equal(h.value, null, 'quote dated before the split is not used');
  p.quotes.AAA = q(27.5, '2026-09-30');
  // quote after split: valued again
  assert.equal(holdings(p)[0].value, 3300);
});

test('F4 unknown cost: web and mobile both show priced value, cost and gain "Not yet known"', () => {
  const p = base();
  p.companies.push(co('BBB'));
  p.trades.push({ id: 't3', ticker: 'BBB', kind: 'opening', date: '2026-01-01', shares: 10, price: null, fees: 0, month: '', note: '' });
  p.quotes.BBB = q(100);
  const w = web(p), m = mobile(p);
  assert.deepEqual([w.value, w.cost, w.gain], [4300, null, null]);
  assert.deepEqual([m.value, m.cost, m.gain], [4300, null, null]);
  assert.deepEqual(m.unknownCost, ['BBB']);
  assert.deepEqual(m.incomplete, ['unknown-cost']);
});

test('F5 missing quote: web and mobile both report gain null and list the unpriced holding', () => {
  const p = base();
  p.companies.push(co('CCC'));
  p.trades.push({ id: 't4', ticker: 'CCC', kind: 'buy', date: '2026-02-01', shares: 10, price: 10, fees: 0, month: '', note: '' });
  const w = web(p), m = mobile(p);
  assert.equal(w.gain, null);
  assert.equal(w.value, 3300);
  assert.equal(m.gain, null);
  assert.equal(m.value, 3300);
  assert.deepEqual(m.missingPrice, ['CCC']);
  assert.deepEqual(m.incomplete, ['missing-price']);
});

test('F6 empty portfolio', () => {
  const p = blankPortfolio();
  assert.deepEqual(web(p), { value: 0, cost: 0, gain: 0 });
  const m = mobile(p);
  assert.deepEqual([m.value, m.gain, m.gainPercent], [0, 0, null]);
});

test('F7 SIP with no targets reports a total-weight error, so the mobile "No targets yet" empty state never renders', () => {
  const p = base();
  const r = buildPlan(p, '2026-10', 0, true);
  assert.ok(r.plan);
  assert.ok(r.plan.errors.includes('Target weights must total 100%.'));
  assert.equal(r.plan.budget, 100000, 'unset budget defaults to PKR 100,000');
});

test('F8 SIP whole shares within budget, fee rounding up', () => {
  const p = base();
  p.companies = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((t) => co(t, 20));
  for (const t of ['BBB', 'CCC', 'DDD', 'EEE']) p.quotes[t] = q(97.35);
  p.budgets['2026-10'] = 10000;
  const r = buildPlan(p, '2026-10', 0.5, true).plan;
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].reason, 'Already at or above target');
  for (const row of r.rows) assert.ok(Number.isInteger(row.shares));
  const row = r.rows[1];
  assert.ok(r.invested <= r.remaining);
  console.log('F8', { shares: row.shares, amount: row.amount, leftover: r.leftover });
});
