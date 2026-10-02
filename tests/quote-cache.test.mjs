import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentWatchQuotes,
  rebaseWatchQuotes,
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
  source: 'https://dps.psx.com.pk/company/X',
  fetched_at: fetchedAt,
});
const quote = (date, fetchedAt, price = 100, manual) => ({
  price,
  asOf: 'as of',
  date,
  source: 'https://dps.psx.com.pk/company/X',
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
  // A manual quote gives way to a PSX quote from a strictly later trading day.
  assert.equal(merged.HUBC.price, 100);
  assert.equal(merged.HUBC.manual, undefined);
  assert.equal(merged.OGDC.price, 55);
  assert.equal(merged.LUCK.price, 100);
  assert.equal(merged.OTHER, undefined);
});

test('mergeQuotes skips malformed cache rows instead of poisoning the portfolio', () => {
  const row = (ticker, source) => ({ ticker, price: 100, as_of: 'now', quote_date: '2026-01-02', source, fetched_at: '2026-01-02T00:00:00Z' });
  const merged = mergeQuotes({}, [row('GOOD', 'https://dps.psx.com.pk/indices/ALLSHR'), row('BAD', 'https://evil.test/')], ['GOOD', 'BAD']);
  assert.deepEqual(Object.keys(merged), ['GOOD']);
});
test('mergeQuotes keeps a manual quote against a same-day or older PSX quote', () => {
  const merged = mergeQuotes(
    {
      HUBC: quote('2026-09-29', '2026-09-29T04:00:00Z', 90, true),
      LUCK: quote('2026-09-29', '2026-09-29T04:00:00Z', 70, true),
    },
    [
      row('HUBC', '2026-09-29', '2026-09-29T11:00:00Z'),
      row('LUCK', '2026-09-28', '2026-09-28T11:00:00Z'),
    ],
    ['HUBC', 'LUCK'],
  );
  assert.equal(merged.HUBC.price, 90);
  assert.equal(merged.LUCK.price, 70);
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

test('lastSessionClose skips PSX holidays as well as weekends', () => {
  // Tue 2026-03-24 11:00 PKT: Mon 23rd (holiday), weekend, Fri 20th (holiday) -> Thu 19th 15:40 PKT.
  assert.equal(
    lastSessionClose(new Date('2026-03-24T06:00:00Z')).toISOString(),
    '2026-03-19T10:40:00.000Z',
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
  const quoteRows = db.writes.filter((args) => args.length === 8);
  assert.equal(quoteRows.length, 1);
  assert.equal(quoteRows[0][0], 'HUBC');
  const failedAttempts = db.writes.filter((args) => args[0] === 'quote' && typeof args[3] === 'string' && /503/.test(args[3])).map((args) => args[1]).sort();
  assert.deepEqual(failedAttempts, ['LUCK', 'NEW'], 'failed attempts are recorded apart from observations');
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

test('rebaseWatchQuotes keeps day change when a newer company-page price overtakes the summary quote', () => {
  const watch = [
    { symbol: 'MEBL', price: 550, change: 10, changePercent: 1.85, sourceTimestamp: '2026-09-29 12:51:00', retrievedAt: '2026-09-29T07:52:00Z' },
    { symbol: 'LUCK', price: 400, change: -4, changePercent: -1, sourceTimestamp: '2026-09-28 15:30:00', retrievedAt: '2026-09-28T10:30:00Z' },
    { symbol: 'GAL', price: 500, change: 5, changePercent: 1, sourceTimestamp: '2026-09-29 12:51:00', retrievedAt: '2026-09-29T07:52:00Z' },
  ];
  const cached = (price, date) => ({ price, asOf: 'Tue, Sep 29, 2026 2:00 PM', date, source: 'https://dps.psx.com.pk/company/X', fetchedAt: '2026-09-29T09:00:00Z' });
  const out = rebaseWatchQuotes(watch, { MEBL: cached(554, '2026-09-29'), LUCK: cached(410, '2026-09-29') });
  assert.deepEqual(out.map((e) => e.symbol), ['MEBL', 'GAL']);
  assert.equal(out[0].price, 554);
  assert.equal(out[0].change, 14);
  assert.equal(out[0].changePercent, 2.59);
  assert.equal(out[0].retrievedAt, '2026-09-29T09:00:00Z');
  assert.equal(out[1].change, 5, 'no cached price leaves the quote untouched');
});

test('a due list longer than the fetch budget is serviced stalest-first so every symbol is eventually refreshed', async () => {
  const { refreshQuotes } = await import('../lib/quote-cache.ts');
  const { fetchBudget } = await import('../lib/psx-fetch.ts');
  const tickers = Array.from({ length: 12 }, (_, i) => `T${String(i).padStart(2, '0')}`);
  const stored = new Map();
  const db = {
    prepare: (sql) => ({
      all: async () => ({ results: [...stored].map(([ticker, fetched_at]) => ({ ticker, price: 1, as_of: 'x', quote_date: '2026-10-02', source: 's', fetched_at })) }),
      bind: (...args) => ({ sql, args }),
    }),
    batch: async (statements) => {
      for (const { args } of statements)
        for (let i = 0; i < args.length; i += 7) stored.set(args[i], args[i + 5]);
    },
  };
  const served = new Set();
  const clock = { n: 0 };
  for (let run = 0; run < 6 && served.size < tickers.length; run++) {
    const result = await refreshQuotes(db, tickers, {
      budget: fetchBudget(3), now: new Date('2026-10-02T06:00:00Z'), force: true,
      fetchQuote: async (ticker) => ({ price: 1, asOf: 'x', date: '2026-10-02', source: 's', fetchedAt: `2026-10-02T05:${String(++clock.n).padStart(2, '0')}:00Z` }),
    });
    result.fetched.forEach((t) => served.add(t));
  }
  assert.equal(served.size, tickers.length);
});

test('after PSX blocks the network, skipped tickers say so instead of "Refresh limit reached"', async () => {
  const db = fakeDB([]);
  const result = await refreshQuotes(db, ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'], {
    now: new Date('2026-09-29T06:00:00Z'),
    fetchQuote: async () => { throw Error('520 from PSX'); },
  });
  const reasons = Object.values(result.failed);
  assert.ok(reasons.some((r) => /520 from PSX/.test(r)));
  assert.ok(reasons.some((r) => /refusing requests from this network/.test(r)));
  assert.ok(!reasons.some((r) => /Refresh limit reached/.test(r)));
});
