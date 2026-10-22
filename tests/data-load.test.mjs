import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnnouncements } from '../lib/dividend-announcements.ts';
import { serverTiming } from '../lib/server-timing.ts';

const row = (ticker, start) => ({ ticker, book_closure_start: start, book_closure_end: start, announced_on: start, kind: 'final', period: 'FY', details: '', percent: 10, per_share_rs: 1 });

function fakeDb(all) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      return {
        bind(...args) {
          queries.push({ sql, args });
          return { all: async () => ({ results: all.filter((r) => args.includes(r.ticker)) }) };
        },
      };
    },
  };
}

test('announcements are read for the asked tickers only, newest book closure first', async () => {
  const db = fakeDb([row('AAA', '2026-01-01'), row('BBB', '2026-03-01'), row('CCC', '2026-02-01'), row('AAA', '2026-04-01')]);
  const out = await readAnnouncements(db, ['AAA', 'BBB', 'AAA']);
  assert.deepEqual(out.map((a) => [a.ticker, a.bookClosureStart]), [['AAA', '2026-04-01'], ['BBB', '2026-03-01'], ['AAA', '2026-01-01']]);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /WHERE ticker IN \(\?,\?\)/);
});

test('announcements: no tickers means no query, long lists are chunked under the bound-parameter limit', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await readAnnouncements(db, []), []);
  assert.equal(db.queries.length, 0);
  await readAnnouncements(db, Array.from({ length: 200 }, (_, i) => `T${i}`));
  assert.deepEqual(db.queries.map((q) => q.args.length), [90, 90, 20]);
});

test('Server-Timing carries only numbers', () => {
  const header = serverTiming(Date.now() - 12, 7)['Server-Timing'];
  assert.match(header, /^total;dur=\d+, rows;desc="rows returned";dur=7$/);
  assert.match(serverTiming(Date.now())['Server-Timing'], /^total;dur=\d+$/);
});
