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

test('the cron Worker runs the fund refresh on weekday nights only', () => {
  const wrangler = readFileSync(
    new URL('../workers/quote-refresh/wrangler.jsonc', import.meta.url),
    'utf8',
  );
  const worker = readFileSync(
    new URL('../workers/quote-refresh/src/index.ts', import.meta.url),
    'utf8',
  );
  const cron = /"(\d+ \d+ \* \* 1-5)"[^\n]*\n/.exec(
    wrangler.replace(/\/\/[^\n]*/g, ''),
  );
  assert.ok(wrangler.includes('"30 17 * * 1-5"'));
  assert.match(worker, /MUFAP_CRONS = new Set\(\['30 17 \* \* 1-5'/);
  assert.ok(cron);
});
