import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The nightly run stores prices only for funds somebody added, and the fetch only ever sends public fund ids.
const source = readFileSync(
  new URL('../lib/mufap-refresh.ts', import.meta.url),
  'utf8',
);

test('only tracked funds get a price row, and ids are validated as digits', () => {
  assert.match(source, /filter\(\(n\) => tracked\.has\(n\.mufapId\)\)/);
  assert.match(source, /\/\^\\d\{1,8\}\$\//);
});

test('the cron Worker has one trigger and runs the fund refresh on weekday nights only', async () => {
  const wrangler = readFileSync(
    new URL('../workers/quote-refresh/wrangler.jsonc', import.meta.url),
    'utf8',
  ).replace(/\/\/[^\n]*/g, '');
  assert.deepEqual(JSON.parse(wrangler).triggers.crons, ['*/5 * * * *']);
  const { isFundRefreshTime } = await import('../lib/scrape-schedule.ts');
  assert.ok(isFundRefreshTime(new Date('2026-10-06T17:30:00Z')));
  assert.ok(!isFundRefreshTime(new Date('2026-10-10T17:30:00Z')));
  assert.ok(!isFundRefreshTime(new Date('2026-10-06T17:35:00Z')));
});

// MUFAP challenges fetches no visitor started (cron, GitHub runners), so prices are refreshed on signed-in visits.
test('a visit refreshes fund prices only when stale and not tried in the last 20 minutes', async () => {
  const { fundsFreshenDue } = await import('../lib/mufap-refresh.ts');
  const now = new Date('2026-11-02T10:00:00Z');
  const ago = (min) => new Date(now.getTime() - min * 60_000).toISOString();
  assert.equal(fundsFreshenDue(null, now), true);
  assert.equal(fundsFreshenDue({ lastAttemptAt: ago(60), lastSuccessAt: ago(60) }, now), false);
  assert.equal(fundsFreshenDue({ lastAttemptAt: ago(300), lastSuccessAt: ago(300) }, now), true);
  assert.equal(fundsFreshenDue({ lastAttemptAt: ago(5), lastSuccessAt: ago(300) }, now), false);
  assert.equal(fundsFreshenDue({ lastAttemptAt: ago(25), lastSuccessAt: null }, now), true);
});

test('once today\'s prices are stored, visits stop fetching until the next weekday', async () => {
  const { fundsFreshenDue, expectedNavDate } = await import('../lib/mufap-refresh.ts');
  const old = '2026-11-01T00:00:00Z';
  // Monday 2 Nov 2026, 15:00 PKT.
  const mon = new Date('2026-11-02T10:00:00Z');
  assert.equal(expectedNavDate(mon), '2026-11-02');
  assert.equal(fundsFreshenDue({ lastAttemptAt: old, lastSuccessAt: old, newest: '2026-11-02' }, mon), false);
  assert.equal(fundsFreshenDue({ lastAttemptAt: old, lastSuccessAt: old, newest: '2026-10-30' }, mon), true);
  // Monday 00:30 PKT is still Sunday in UTC: the date follows Pakistan.
  assert.equal(expectedNavDate(new Date('2026-11-01T19:30:00Z')), '2026-11-02');
  // Saturday and Sunday want Friday's prices, so a weekend with Friday's in fetches nothing.
  const sun = new Date('2026-11-08T10:00:00Z');
  assert.equal(expectedNavDate(sun), '2026-11-06');
  assert.equal(fundsFreshenDue({ lastAttemptAt: old, lastSuccessAt: old, newest: '2026-11-06' }, sun), false);
});

test('freshenFunds claims the refresh, so only one visitor fetches MUFAP at a time', async () => {
  const { freshenFunds } = await import('../lib/mufap-refresh.ts');
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              calls.push(sql);
              // The claim finds a newer attempt by somebody else.
              return { meta: { changes: sql.includes('ON CONFLICT') ? 0 : 1 } };
            },
          };
        },
      };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('must not fetch MUFAP without the claim');
  try {
    assert.deepEqual(await freshenFunds(db), { ran: false });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
});

test('the cron Worker no longer fetches MUFAP, and the web app asks on each visit', () => {
  const worker = readFileSync(new URL('../workers/quote-refresh/src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /refreshFunds|refreshFundPayouts|DurableObject/);
  const hook = readFileSync(new URL('../app/use-fund-data.ts', import.meta.url), 'utf8');
  assert.match(hook, /freshenFunds\?\.\(\)/);
});
