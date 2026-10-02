import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSupportedIndices, mergeIndexSnapshot, SUPPORTED_INDICES } from '../lib/index-snapshot.ts';

const html = readFileSync(new URL('./fixtures/psx-home-all-indices.html', import.meta.url), 'utf8');

test('all four indices parse from one page', () => {
  const { indices, failures } = parseSupportedIndices(html);
  assert.deepEqual(Object.keys(failures), []);
  assert.deepEqual(Object.keys(indices).sort(), [...SUPPORTED_INDICES].sort());
  for (const code of SUPPORTED_INDICES) assert.ok(indices[code].close > 0, code);
});

test('one malformed index does not discard the others', () => {
  const broken = html.replace(/(marketIndices__details" data-name="KMI30"[^>]*?)data-close="[^"]*"/, '$1data-closeX="1"');
  const { indices, failures } = parseSupportedIndices(broken);
  assert.ok(failures.KMI30);
  assert.ok(indices.KSE100 && indices.KSE30 && indices.ALLSHR);
});

test('a partial failure keeps the stored index and its timestamps untouched', () => {
  const full = parseSupportedIndices(html);
  const first = mergeIndexSnapshot(null, full, '2026-10-02T05:00:00Z');
  const partial = { indices: { ...full.indices }, failures: { KMI30: 'markup changed' } };
  delete partial.indices.KMI30;
  const second = mergeIndexSnapshot(first, partial, '2026-10-02T05:05:00Z');
  assert.equal(second.KMI30.retrievedAt, '2026-10-02T05:00:00Z', 'old data is not re-dated');
  assert.equal(second.KMI30.lastFailure.message, 'markup changed');
  assert.equal(second.KSE100.retrievedAt, '2026-10-02T05:05:00Z');
  assert.equal(second.KSE100.lastFailure, null);
});

test('an older source observation never replaces a newer one', () => {
  const full = parseSupportedIndices(html);
  const first = mergeIndexSnapshot(null, full, '2026-10-02T05:00:00Z');
  const older = structuredClone(full);
  older.indices.KSE30.asOf = '2000-01-01 10:00:00';
  older.indices.KSE30.close = 1;
  const merged = mergeIndexSnapshot(first, older, '2026-10-02T05:10:00Z');
  assert.equal(merged.KSE30.summary.close, full.indices.KSE30.close);
  assert.equal(merged.KSE30.retrievedAt, '2026-10-02T05:00:00Z');
});

test('a failure with nothing stored creates no entry (never a zero)', () => {
  const merged = mergeIndexSnapshot(null, { indices: {}, failures: { KSE30: 'x' } }, '2026-10-02T05:00:00Z');
  assert.deepEqual(merged, {});
});

test('sampled series: one real point per new observation, reset each day, never interpolated', async () => {
  const { growIndexSeries } = await import('../lib/index-snapshot.ts');
  const at = (asOf, close) => ({ KSE30: { asOf, date: asOf.slice(0, 10), close } });
  let series = growIndexSeries(null, at('2026-10-01 15:00:00', 100));
  series = growIndexSeries(series, at('2026-10-02 10:00:00', 101));
  assert.equal(series.KSE30.length, 1, 'yesterday point dropped on a new day');
  series = growIndexSeries(series, at('2026-10-02 10:05:00', 102));
  series = growIndexSeries(series, at('2026-10-02 10:05:00', 999));
  series = growIndexSeries(series, at('2026-10-02 09:00:00', 5));
  assert.deepEqual(series.KSE30.map((p) => p.value), [101, 102], 'repeat and older observations add nothing');
  assert.equal(growIndexSeries(series, {}).KSE30.length, 2, 'a failed index keeps its series');
});
