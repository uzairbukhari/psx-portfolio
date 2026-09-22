import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveQuote, mergeEffectiveQuotes } from '../lib/quotes.ts';

const cacheRow = (over = {}) => ({
  ticker: 'TEST', price: 100, asOf: '2026-09-20', quoteDate: '2026-09-20',
  source: 'https://dps.psx.com.pk/company/TEST', fetchedAt: '2026-09-20T12:00:00.000Z', ...over,
});
const saved = (over = {}) => ({
  price: 90, asOf: '2026-09-18', date: '2026-09-18',
  source: 'https://dps.psx.com.pk/company/TEST', fetchedAt: '2026-09-18T12:00:00.000Z', ...over,
});

test('a manual saved quote is never overwritten by the cache', () => {
  const s = saved({ manual: true });
  assert.deepEqual(effectiveQuote(s, cacheRow()), s);
});

test('a newer cache row replaces an older non-manual saved quote', () => {
  const result = effectiveQuote(saved(), cacheRow());
  assert.equal(result?.price, 100);
  assert.equal(result?.date, '2026-09-20');
});

test('an older cache row does not overwrite a newer saved non-manual quote', () => {
  const newerSaved = saved({ price: 105, fetchedAt: '2026-09-21T09:00:00.000Z', date: '2026-09-21' });
  const olderCache = cacheRow({ fetchedAt: '2026-09-20T12:00:00.000Z', quoteDate: '2026-09-20' });
  const result = effectiveQuote(newerSaved, olderCache);
  assert.equal(result?.price, 105);
  assert.equal(result?.date, '2026-09-21');
});

test('no cache row leaves the saved quote unchanged', () => {
  const s = saved();
  assert.deepEqual(effectiveQuote(s, undefined), s);
});

test('no saved quote at all takes the cache row', () => {
  const result = effectiveQuote(undefined, cacheRow());
  assert.equal(result?.price, 100);
});

test('mergeEffectiveQuotes applies effectiveQuote per ticker across the whole book', () => {
  const merged = mergeEffectiveQuotes(
    { A: saved({ manual: true }), B: saved() },
    [cacheRow({ ticker: 'A', price: 1 }), cacheRow({ ticker: 'B', price: 2 }), cacheRow({ ticker: 'C', price: 3 })],
  );
  assert.equal(merged.A.price, 90); // manual, untouched
  assert.equal(merged.B.price, 2); // newer cache wins
  assert.equal(merged.C.price, 3); // new ticker introduced by cache
});
