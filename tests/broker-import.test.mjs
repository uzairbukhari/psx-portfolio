import test from 'node:test';
import assert from 'node:assert/strict';
import { planBrokerImport, applyBrokerImport, validateBrokerStatement } from '../lib/broker-import.ts';
import { holdings, validate } from '../lib/portfolio.ts';
const empty = () => ({ companies: [], trades: [], quotes: {}, budgets: {} });
const statement = (trades, snaps = []) => validateBrokerStatement({ broker: 'JS Global', account: 'main', report: snaps.length ? 'both' : 'trades', trades, holdings: snaps, warnings: [] });
const fill = (reference, shares = 10) => ({ ticker: 'MEBL', date: '2026-09-01', side: 'buy', shares, price: 100, fees: 1, reference, line: 2 });

test('repeat and overlap imports do not duplicate trades while repeated fills survive', () => {
  const s = statement([fill('A'), fill('B')]);
  const first = planBrokerImport(empty(), s);
  assert.equal(first.rows.filter((r) => r.action === 'import').length, 2);
  const saved = applyBrokerImport(empty(), s, first);
  assert.equal(holdings(saved).find((h) => h.ticker === 'MEBL').shares, 20);
  const repeated = planBrokerImport(saved, s);
  assert.equal(repeated.rows.filter((r) => r.action === 'import').length, 0);
  assert.equal(repeated.rows.filter((r) => r.status === 'duplicate').length, 2);
});

test('holding mismatch requires decision and stays out of realised sales', () => {
  const s = statement([fill('A')], [{ ticker: 'MEBL', asOf: '2026-09-02', shares: 8, line: 5 }]);
  const draft = planBrokerImport(empty(), s);
  assert.equal(draft.adjustments[0].difference, -2);
  assert.ok(draft.blockers.length);
  const agreed = planBrokerImport(empty(), s, { [draft.adjustments[0].key]: 'import' });
  assert.equal(agreed.blockers.length, 0);
  const saved = applyBrokerImport(empty(), s, agreed);
  assert.equal(holdings(saved)[0].shares, 8);
  assert.equal(holdings(saved)[0].cost, null);
  assert.equal(saved.trades.filter((t) => t.kind === 'sell').length, 0);
  validate(saved);
  const repeat = planBrokerImport(saved, s);
  assert.equal(repeat.adjustments.length, 0);
});

test('legacy holdings are assigned explicitly before a broker balance is reconciled', () => {
  const p = empty();
  p.companies.push({ ticker: 'MEBL', name: 'MEBL', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'old', ticker: 'MEBL', kind: 'opening', date: '2026-08-01', shares: 10, price: null, fees: 0, month: '', note: 'old' });
  const s = statement([], [{ ticker: 'MEBL', asOf: '2026-09-02', shares: 10, line: 2 }]);
  assert.ok(planBrokerImport(p, s).blockers.length);
  const plan = planBrokerImport(p, s, {}, ['old']);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.adjustments.length, 0);
  const next = applyBrokerImport(p, s, plan);
  assert.equal(next.trades[0].accountId, 'JS GLOBAL:MAIN');
  assert.equal(next.trades[0].shares, 10);
});
