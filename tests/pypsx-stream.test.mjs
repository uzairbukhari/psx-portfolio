import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamGate } from '../lib/pypsx-stream.ts';

const tick = (ticker, sourceTimestamp, price = 1) => ({ ticker, price, sourceTimestamp, high: null, low: null, volume: null, change: null, changePercent: null, providerMarketState: null, receivedAt: 'x' });

test('an older tick for a ticker is rejected, other tickers are independent', () => {
  const gate = createStreamGate();
  assert.ok(gate.accept(tick('A', '2026-10-02T05:00:10Z')));
  assert.equal(gate.accept(tick('A', '2026-10-02T05:00:05Z')), null);
  assert.ok(gate.accept(tick('B', '2026-10-02T05:00:01Z')));
  assert.ok(gate.accept(tick('A', '2026-10-02T05:00:10Z')), 'equal time is allowed');
});
test('ticks without a source time are forwarded but flagged so a socket is not read as a fresh quote', () => {
  const out = createStreamGate().accept(tick('A', null));
  assert.equal(out.timeKnown, false);
});
test('idle and max-age limits close the connection', () => {
  let t = 0;
  const gate = createStreamGate({ now: () => t, idleMs: 1000, maxMs: 5000 });
  assert.equal(gate.expiry(), null);
  t = 1500; assert.equal(gate.expiry(), 'idle');
  gate.heard(); assert.equal(gate.expiry(), null);
  t = 5200; gate.heard(); assert.equal(gate.expiry(), 'max-age');
});
