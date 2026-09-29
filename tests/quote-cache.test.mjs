import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentWatchQuotes,
  isFresh,
  lastSessionClose,
  mergeQuotes,
  refreshQuotes,
} from '../lib/quote-cache.ts';
import { fetchBudget, fetchPsx } from '../lib/psx-fetch.ts';

const row = (ticker, date, fetchedAt, price = 100) => ({
  ticker,
  price,
  as_of: 'as of',
  quote_date: date,
  source: 'psx',
  fetched_at: fetchedAt,
});
const quote = (date, fetchedAt, price = 100, manual) => ({
  price,
  asOf: 'as of',
  date,
  source: 'psx',
  fetchedAt,
  ...(manual ? { manual } : {}),
});

test('mergeQuotes keeps newer or manual saved quotes and fills the rest', () => {
  const merged = mergeQuotes(
    {
      MEBL: quote('2026-09-29', '2026-09-29T05:38:00Z', 120),
      HUBC: quote('2026-09-20', '2026-09-20T05:00:00Z', 90, true),
      OGDC: quote('2026-09-28', '2026-09-28T07:00:00Z', 50),
    },
    [
      row('MEBL', '2026-09-28', '2026-09-28T11:00:00Z'),
      row('HUBC', '2026-09-29', '2026-09-29T06:00:00Z'),
      row('OGDC', '2026-09-28', '2026-09-28T11:00:00Z', 55),
      row('LUCK', '2026-09-29', '2026-09-29T06:00:00Z'),
      row('OTHER', '2026-09-29', '2026-09-29T06:00:00Z'),
    ],
    ['MEBL', 'HUBC', 'OGDC', 'LUCK'],
  );
  assert.equal(merged.MEBL.price, 120);
  assert.equal(merged.HUBC.price, 90);
  assert.equal(merged.OGDC.price, 55);
  assert.equal(merged.LUCK.price, 100);
  assert.equal(merged.OTHER, undefined);
});

test('lastSessionClose skips weekends and uses the Friday close', () => {
  // Sunday 2026-09-27 12:00 PKT -> Friday 2026-09-25 16:40 PKT (11:40Z).
  assert.equal(
    lastSessionClose(new Date('2026-09-27T07:00:00Z')).toISOString(),
    '2026-09-25T11:40:00.000Z',
  );
  // Tuesday 10:00 PKT -> Monday 15:40 PKT (10:40Z).
  assert.equal(
    lastSessionClose(new Date('2026-09-29T05:00:00Z')).toISOString(),
    '2026-09-28T10:40:00.000Z',
  );
});

test('isFresh uses a short TTL while open and the last close while shut', () => {
  const open = new Date('2026-09-29T06:00:00Z'); // Tue 11:00 PKT
  assert.equal(isFresh('2026-09-29T05:52:00Z', open), true);
  assert.equal(isFresh('2026-09-29T05:45:00Z', open), false);
  const evening = new Date('2026-09-29T15:00:00Z'); // Tue 20:00 PKT
  assert.equal(isFresh('2026-09-29T10:45:00Z', evening), true);
  assert.equal(isFresh('2026-09-29T09:00:00Z', evening), false);
  assert.equal(isFresh(undefined, evening), false);
});

function fakeDB(rows) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        sql,
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          return { results: rows };
        },
      };
    },
    async batch(statements) {
      writes.push(...statements.map((statement) => statement.args));
    },
  };
}

test('refreshQuotes fetches only stale tickers and falls back to cache on failure', async () => {
  const now = new Date('2026-09-29T06:00:00Z');
  const db = fakeDB([
    row('MEBL', '2026-09-29', '2026-09-29T05:59:00Z'),
    row('LUCK', '2026-09-28', '2026-09-28T11:00:00Z', 80),
  ]);
  const calls = [];
  const result = await refreshQuotes(db, ['MEBL', 'LUCK', 'HUBC', 'NEW'], {
    now,
    fetchQuote: async (ticker) => {
      calls.push(ticker);
      if (ticker === 'LUCK' || ticker === 'NEW') throw Error('503 from PSX');
      return quote('2026-09-29', now.toISOString(), 200);
    },
  });
  assert.deepEqual(calls.toSorted((a, b) => a.localeCompare(b)), ['HUBC', 'LUCK', 'NEW']);
  assert.equal(result.quotes.MEBL.price, 100);
  assert.equal(result.quotes.LUCK.price, 80);
  assert.equal(result.stale.LUCK, '503 from PSX');
  assert.equal(result.failed.NEW, '503 from PSX');
  assert.equal(result.quotes.HUBC.price, 200);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0][0], 'HUBC');
});

test('refreshQuotes stops at the budget and serves the rest from cache', async () => {
  const now = new Date('2026-09-29T06:00:00Z');
  const db = fakeDB([row('A1', '2026-09-28', '2026-09-28T11:00:00Z')]);
  const result = await refreshQuotes(db, ['A1', 'B1', 'C1'], {
    now,
    budget: fetchBudget(0),
    fetchQuote: async () => assert.fail('no fetch expected'),
  });
  assert.equal(result.quotes.A1.price, 100);
  assert.ok(result.stale.A1);
  assert.ok(result.failed.B1 && result.failed.C1);
});

test('fetchPsx does not retry a 404 and spends budget per attempt', async (t) => {
  let hits = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    hits++;
    return new Response('gone', { status: hits === 1 ? 503 : 404 });
  });
  const budget = fetchBudget(5);
  await assert.rejects(fetchPsx('https://dps.psx.com.pk/x', budget), /404 from PSX/);
  assert.equal(hits, 2);
  assert.equal(budget.left, 3);
});

test('refreshQuotes stops fetching once PSX blocks the network', async () => {
  const now = new Date('2026-09-29T06:00:00Z');
  const db = fakeDB([]);
  let calls = 0;
  const result = await refreshQuotes(db, ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'], {
    now,
    fetchQuote: async () => {
      calls++;
      throw Error('520 from PSX');
    },
  });
  assert.equal(calls, 3);
  assert.equal(Object.keys(result.failed).length, 6);
});

test('currentWatchQuotes keeps summary quotes stamped at the same time as the cache', () => {
  const at = '2026-09-29T07:52:30Z';
  const watch = [
    { symbol: 'MEBL', retrievedAt: at },
    { symbol: 'GAL', retrievedAt: at },
    { symbol: 'LUCK', retrievedAt: '2026-09-29T07:00:00Z' },
  ];
  const kept = currentWatchQuotes(watch, {
    MEBL: quote('2026-09-29', at),
    LUCK: quote('2026-09-29', '2026-09-29T07:30:00Z'),
  });
  assert.deepEqual(kept.map((entry) => entry.symbol), ['MEBL', 'GAL']);
});
