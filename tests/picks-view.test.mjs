import test from 'node:test';
import assert from 'node:assert/strict';
import { dataNote, leftOutNotes, orderText, ownShares, picksRows } from '../lib/picks-view.ts';

const cov = (ticker, score, over = {}) => ({ ticker, outlook: 'Neutral', summary: '', sourceUrls: [], assessmentStatus: 'assessed', metrics: { peTtm: 8, earningsYieldPct: 12, epsYoYPct: 10, change1yPct: 5, score }, ...over });
const result = {
  marketOutlook: '', unallocatedPct: 0,
  picks: [{ ticker: 'MEBL' }, { ticker: 'HUBC' }],
  coverage: [cov('MEBL', 81), cov('HUBC', 74), cov('PPL', 48), cov('XYZ', 90, { ineligibleReason: 'Loss-making' }), cov('HBL', 66), cov('NODATA', null, { assessmentStatus: 'unassessed', metrics: undefined })],
  sizing: { picks: [{ ticker: 'HBL', requestedPct: 20, allocationPkr: 0, constrainedBy: 'overweight' }] },
};
const list = ['FFC', 'PPL', 'HUBC', 'MEBL', 'XYZ', 'HBL', 'NODATA'].map((ticker) => ({ ticker, name: ticker }));
const held = [{ ticker: 'HBL', valuePkr: 21_000 }, { ticker: 'MEBL', valuePkr: 12_000 }, { ticker: 'Z', valuePkr: 67_000 }, { ticker: 'N', valuePkr: null }];

test('every ticked company gets one outcome, picks first in rank order', () => {
  const rows = picksRows({ list, shortlist: ['PPL', 'HUBC', 'MEBL', 'XYZ', 'HBL', 'NODATA'], result, facts: {}, held, order: 'ranked' });
  assert.deepEqual(rows.map((r) => r.ticker).slice(0, 2), ['MEBL', 'HUBC']);
  const tag = (t) => rows.find((r) => r.ticker === t).tag;
  assert.deepEqual(tag('MEBL'), { kind: 'pick', text: 'Pick 1' });
  assert.deepEqual(tag('HUBC'), { kind: 'pick', text: 'Pick 2' });
  assert.equal(tag('PPL').text, 'Below 55');
  assert.equal(tag('XYZ').text, 'Not eligible');
  assert.equal(tag('HBL').text, 'Over 20%');
  assert.equal(tag('NODATA').text, 'No data');
  assert.equal(tag('FFC'), null, 'unticked companies carry no outcome');
  assert.equal(rows.at(-1).ticker, 'FFC', 'unticked sink to the bottom');
});

test('A to Z ordering ignores rank', () => {
  const rows = picksRows({ list, shortlist: ['MEBL'], result, facts: {}, held, order: 'name' });
  assert.deepEqual(rows.map((r) => r.ticker), [...list.map((l) => l.ticker)].sort());
});

test('ownership is a share of the stocks with a known value', () => {
  const shares = ownShares(held);
  assert.equal(shares.get('HBL'), 21);
  assert.equal(shares.get('MEBL'), 12);
  assert.equal(shares.has('N'), false);
});

test('left-out notes name the company and the limit', () => {
  const rows = picksRows({ list, shortlist: ['HBL'], result, facts: {}, held, order: 'ranked' });
  assert.match(leftOutNotes(rows)[0], /HBL is left out: it is already 21% of your stocks \(limit 20%\)/);
});

test('data notes say how old the data is', () => {
  assert.equal(dataNote({ state: 'fresh', ageDays: 0 }).text, 'data today');
  assert.equal(dataNote({ state: 'fresh', ageDays: 2 }).text, 'data 2d old');
  assert.deepEqual(dataNote({ state: 'stale', ageDays: 9 }), { text: 'data 9d old', stale: true });
  assert.equal(dataNote(undefined).text, 'no data yet');
});

test('order text lists only picks with shares', () => {
  const text = orderText([{ ticker: 'MEBL', shares: 32, price: 320 }, { ticker: 'HUBC', shares: 0, price: 210 }, { ticker: 'LUCK', shares: null, price: null }], '2026-10');
  assert.equal(text, 'Monthly Picks 2026-10\nMEBL BUY 32 @ about 320.00');
  assert.equal(orderText([], '2026-10'), '');
});
