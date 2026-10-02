import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeAllocation } from '../lib/monthly-picks-allocation.ts';

const sum = (r) => r.picks.reduce((s, p) => s + p.allocationPaisa, 0) + r.cashPaisa;

test('weights under both caps are kept unchanged', () => {
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 15 }, { ticker: 'B', allocationPct: 15 }], [], 100_000);
  assert.deepEqual(r.picks.map((p) => p.allocationPaisa), [1_500_000, 1_500_000]);
  assert.equal(r.cashPaisa, 7_000_000);
  assert.equal(sum(r), 10_000_000);
});

test('an empty portfolio still limits one pick to 20% (concentration beats the 35% contribution cap)', () => {
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 100 }], [], 100_000);
  assert.equal(r.picks[0].allocationPaisa, 2_000_000);
  assert.equal(r.picks[0].constrainedBy, 'concentration_cap');
  assert.equal(r.cashPaisa, 8_000_000);
});

test('purchases cannot lift a holding above 20% of portfolio plus fresh money', () => {
  // Portfolio 900k incl. 170k in A, plus 100k fresh -> limit 200k; A has 30k room.
  const holdings = [{ ticker: 'A', valuePkr: 170_000 }, { ticker: 'Z', valuePkr: 730_000 }];
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 35 }, { ticker: 'B', allocationPct: 35 }], holdings, 100_000);
  const a = r.picks.find((p) => p.ticker === 'A');
  assert.equal(a.allocationPaisa, 3_000_000);
  assert.equal(a.constrainedBy, 'concentration_cap');
  assert.ok(170_000 + a.allocationPaisa / 100 <= 200_000);
});

test('an overweight holding gets nothing and the money moves to a pick with room', () => {
  const holdings = [{ ticker: 'A', valuePkr: 500_000 }, { ticker: 'Z', valuePkr: 500_000 }];
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 30 }, { ticker: 'B', allocationPct: 30 }], holdings, 100_000);
  assert.equal(r.picks.find((p) => p.ticker === 'A').allocationPaisa, 0);
  assert.equal(r.picks.find((p) => p.ticker === 'A').constrainedBy, 'overweight');
  assert.equal(r.picks.find((p) => p.ticker === 'B').allocationPaisa, 3_500_000);
  assert.equal(sum(r), 10_000_000);
});

test('constrained money is redistributed pro rata among picks with room', () => {
  const holdings = [{ ticker: 'A', valuePkr: 170_000 }, { ticker: 'Z', valuePkr: 730_000 }];
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 40 }, { ticker: 'B', allocationPct: 20 }, { ticker: 'C', allocationPct: 20 }], holdings, 100_000);
  const by = Object.fromEntries(r.picks.map((p) => [p.ticker, p.allocationPaisa]));
  assert.equal(by.A, 3_000_000);
  assert.equal(by.B, 2_500_000);
  assert.equal(by.C, 2_500_000);
  assert.equal(sum(r), 10_000_000);
});

test('missing valuation on a held position marks the result incomplete', () => {
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 30 }], [{ ticker: 'Z', valuePkr: null }], 100_000);
  assert.equal(r.incomplete, true);
  assert.deepEqual(r.missingValuations, ['Z']);
  assert.equal(r.picks[0].allocationPaisa, 3_000_000, 'only the 35% contribution cap applies');
});

test('empty picks keep the whole amount as cash', () => {
  const r = sizeAllocation([], [{ ticker: 'Z', valuePkr: 10 }], 5_000.55);
  assert.equal(r.cashPaisa, 500_055);
  assert.deepEqual(r.picks, []);
});

test('budget always adds up in paisa for awkward amounts', () => {
  const r = sizeAllocation([{ ticker: 'A', allocationPct: 33.33 }, { ticker: 'B', allocationPct: 33.33 }, { ticker: 'C', allocationPct: 33.34 }], [], 12_345.67);
  assert.equal(sum(r), 1_234_567);
  assert.ok(r.picks.every((p) => p.allocationPaisa <= Math.floor(1_234_567 * 0.35)));
});

test('applySizing rewrites percentages, drops zero-money picks and records the holdings fingerprint', async () => {
  const { applySizing } = await import('../lib/monthly-picks-allocation.ts');
  const holdings = [{ ticker: 'A', valuePkr: 500_000 }, { ticker: 'Z', valuePkr: 500_000 }];
  const result = applySizing({ picks: [{ ticker: 'A', allocationPct: 30 }, { ticker: 'B', allocationPct: 30 }], unallocatedPct: 40 }, holdings, 100_000);
  assert.deepEqual(result.picks.map((p) => p.ticker), ['B']);
  assert.equal(result.picks[0].allocationPct, 35);
  assert.equal(result.unallocatedPct, 65);
  assert.equal(result.sizing.picks.find((p) => p.ticker === 'A').constrainedBy, 'overweight');
  assert.match(result.sizing.holdingsFingerprint, /^2-/);
});

test('applySizing keeps a cash-only result at 100% cash', async () => {
  const { applySizing } = await import('../lib/monthly-picks-allocation.ts');
  const result = applySizing({ picks: [], unallocatedPct: 100 }, [], 50_000);
  assert.equal(result.unallocatedPct, 100);
  assert.equal(result.sizing.cashPkr, 50_000);
});

test('explainSizing names each constrained pick and flags missing valuations', async () => {
  const { explainSizing } = await import('../lib/monthly-picks-allocation.ts');
  const lines = explainSizing({ holdingsFingerprint: 'x', computedAt: 'x', incomplete: true, missingValuations: ['Z'], cashPkr: 0,
    picks: [{ ticker: 'A', requestedPct: 30, allocationPkr: 0, constrainedBy: 'overweight' }, { ticker: 'B', requestedPct: 30, allocationPkr: 1, constrainedBy: null }] });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^A: .*nothing is sold/);
  assert.match(lines[1], /no price for Z/);
  assert.deepEqual(explainSizing(undefined), []);
});
