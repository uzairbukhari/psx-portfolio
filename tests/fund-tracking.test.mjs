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
