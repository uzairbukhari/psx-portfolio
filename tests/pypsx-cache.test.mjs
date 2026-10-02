import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntradayCache } from '../lib/pypsx-cache.ts';

const snap = (ticker, sourceTimestamp, price = 10) => ({ ticker, price, sourceTimestamp, points: [] });

test('repeated reads inside the TTL make exactly one provider request', async () => {
  let clock = 0, calls = 0;
  const cache = createIntradayCache({ now: () => clock, fetchOne: async () => { calls++; return snap('A', '2026-10-02T05:00:00Z'); } });
  for (let i = 0; i < 20; i++) await cache.get('A');
  assert.equal(calls, 1);
  clock = 31_000;
  await cache.get('A');
  assert.equal(calls, 2, 'refetched after 30 s');
});

test('concurrent readers share one in-flight request', async () => {
  let calls = 0;
  const cache = createIntradayCache({ fetchOne: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return snap('A', 't'); } });
  await Promise.all(Array.from({ length: 10 }, () => cache.get('A')));
  assert.equal(calls, 1);
});

test('a hung provider is aborted after the deadline and reads as unavailable', async () => {
  const cache = createIntradayCache({
    timeoutMs: 20,
    fetchOne: (_key, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  assert.equal(await cache.get('A'), null);
});

test('an older observation never replaces a newer one', async () => {
  let clock = 0;
  const answers = [snap('A', '2026-10-02T06:00:00Z', 12), snap('A', '2026-10-02T05:00:00Z', 9)];
  const cache = createIntradayCache({ now: () => clock, fetchOne: async () => answers.shift() });
  assert.equal((await cache.get('A')).price, 12);
  clock = 60_000;
  assert.equal((await cache.get('A')).price, 12, 'late, older tick is rejected');
});

test('a failure is cached briefly so an outage is not hammered', async () => {
  let clock = 0, calls = 0;
  const cache = createIntradayCache({ now: () => clock, fetchOne: async () => { calls++; throw new Error('down'); } });
  await cache.get('A'); await cache.get('A'); await cache.get('A');
  assert.equal(calls, 1);
  clock = 16_000;
  await cache.get('A');
  assert.equal(calls, 2);
});
