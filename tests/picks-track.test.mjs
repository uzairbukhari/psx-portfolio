import test from 'node:test';
import assert from 'node:assert/strict';
import { picksTrack } from '../lib/picks-track.ts';

const day = (d) => Date.parse(`${d}T12:00:00Z`) / 1000;
const index = [[day('2026-08-03'), 100], [day('2026-09-01'), 110], [day('2026-10-21'), 121]];
const buy = (id, ticker, date, shares, price, runId, extra = {}) => ({ id, ticker, kind: 'buy', date, shares, price, fees: 0, month: date.slice(0, 7), note: '', picksRunId: runId, ...extra });
const run = (id, month, picks) => ({ id, month, result: { picks: picks.map((ticker) => ({ ticker })) } });

test('return of the buys is set against the index bought the same days', () => {
  const t = picksTrack({
    trades: [buy('a', 'MEBL', '2026-08-03', 10, 100, 'r1'), buy('b', 'HUBC', '2026-08-03', 10, 100, 'r1')],
    runs: [run('r1', '2026-08', ['MEBL', 'HUBC', 'PPL'])],
    quotes: { MEBL: { price: 130 }, HUBC: { price: 110 } },
    index, asOf: '2026-10-21',
  });
  const [m] = t.months;
  assert.equal(m.boughtPkr, 2000);
  assert.equal(m.returnPct, 20);
  assert.equal(m.indexPct, 21);
  assert.deepEqual(m.followed, { bought: 2, of: 3 });
});

test('unpriced buys leave the return unknown, not zero', () => {
  const t = picksTrack({ trades: [buy('a', 'MEBL', '2026-08-03', 10, 100, 'r1')], runs: [run('r1', '2026-08', ['MEBL'])], quotes: {}, index, asOf: '2026-10-21' });
  assert.equal(t.months[0].returnPct, null);
  assert.equal(t.returnPct, null);
});

test('index history that starts after a buy leaves the comparison out', () => {
  const t = picksTrack({ trades: [buy('a', 'MEBL', '2026-07-01', 10, 100, 'r1')], runs: [run('r1', '2026-07', ['MEBL'])], quotes: { MEBL: { price: 120 } }, index, asOf: '2026-10-21' });
  assert.equal(t.months[0].returnPct, 20);
  assert.equal(t.months[0].indexPct, null);
});

test('voided, sold, untagged buys and runs without buys are ignored; months list newest first and are capped', () => {
  const runs = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => run(`r${i}`, m, ['MEBL']));
  const trades = runs.map((r, i) => buy(`t${i}`, 'MEBL', '2026-08-03', 1, 100, r.id));
  trades.push(buy('v', 'MEBL', '2026-08-03', 1, 100, 'r0', { voided: true }), { ...buy('s', 'MEBL', '2026-08-03', 1, 100, 'r1'), kind: 'sell' }, buy('u', 'MEBL', '2026-08-03', 1, 100, undefined));
  const t = picksTrack({ trades, runs: [...runs, run('empty', '2026-04', ['A'])], quotes: { MEBL: { price: 100 } }, index, asOf: '2026-10-21', months: 4 });
  assert.deepEqual(t.months.map((m) => m.month), ['2026-10', '2026-09', '2026-08', '2026-07']);
  assert.equal(t.months[0].boughtPkr, 100);
});
