import assert from 'node:assert/strict';
import test from 'node:test';
import { scrapeExitCode } from '../scripts/scrape-exit.mjs';

test('scraper succeeds when there are no tickers to scrape', () => {
  assert.equal(scrapeExitCode(0, 0), 0);
});

test('scraper tolerates up to 20% failed tickers', () => {
  assert.equal(scrapeExitCode(10, 0), 0);
  assert.equal(scrapeExitCode(10, 2), 0);
  assert.equal(scrapeExitCode(5, 1), 0);
});

test('scraper fails when more than 20% of tickers fail', () => {
  assert.equal(scrapeExitCode(10, 3), 1);
  assert.equal(scrapeExitCode(4, 1), 1);
  assert.equal(scrapeExitCode(1, 1), 1);
});
