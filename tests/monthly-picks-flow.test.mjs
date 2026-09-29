import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyFacts, needsScrape, scrapeSettled, nextGatherStep, unavailableReason, canReuseRun,
  FACTS_MAX_AGE_DAYS, GATHER_TIMEOUT_MS,
} from '../lib/monthly-picks-flow.ts';
import { parseCompanyPage, overlayQuote } from '../lib/company-facts.ts';

const DAY = '2026-09-29';
const START = '2026-09-29T08:00:00.000Z';
const at = (offsetMs) => new Date(Date.parse(START) + offsetMs).toISOString();

test('classifies facts by presence, age and last scrape error', () => {
  assert.equal(classifyFacts('AAA', DAY, null, DAY).state, 'fresh');
  assert.equal(classifyFacts('AAA', '2026-09-22', null, DAY).state, 'fresh');
  const stale = classifyFacts('AAA', '2026-09-21', null, DAY);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.ageDays, 8);
  assert.equal(classifyFacts('AAA', null, null, DAY).state, 'missing');
  const failed = classifyFacts('AAA', null, { requestedAt: START, attemptedAt: at(1000), error: '520 from PSX' }, DAY);
  assert.equal(failed.state, 'failed');
  assert.match(unavailableReason(failed), /520 from PSX/);
  assert.match(unavailableReason(classifyFacts('AAA', null, null, DAY)), /No PSX company data yet/);
  assert.equal(FACTS_MAX_AGE_DAYS, 7);
});

test('only non-fresh tickers need a scrape', () => {
  assert.equal(needsScrape(classifyFacts('A', DAY, null, DAY)), false);
  assert.equal(needsScrape(classifyFacts('A', null, null, DAY)), true);
  assert.equal(needsScrape(classifyFacts('A', '2026-09-01', null, DAY)), true);
});

test('a scrape settles only when attempted after the run started and after the request', () => {
  const request = (attemptedAt) => classifyFacts('A', null, { requestedAt: at(500), attemptedAt, error: 'boom' }, DAY);
  assert.equal(scrapeSettled(request(null), START), false);
  assert.equal(scrapeSettled(request(at(100)), START), false, 'attempt older than the request');
  assert.equal(scrapeSettled(request(at(-5000)), START), false, 'attempt from before this run');
  assert.equal(scrapeSettled(request(at(2000)), START), true, 'failed attempt still ends the wait');
  assert.equal(scrapeSettled(classifyFacts('A', DAY, null, DAY), START), true, 'fresh facts landed');
});

test('gather step waits, proceeds when settled, and proceeds on timeout', () => {
  const pending = [
    classifyFacts('AAA', null, { requestedAt: at(500), attemptedAt: null, error: null }, DAY),
    classifyFacts('BBB', DAY, null, DAY),
  ];
  const wait = nextGatherStep({ startedAt: START, now: Date.parse(START) + 60_000, pending });
  assert.deepEqual(wait, { action: 'wait', pending: ['AAA'] });
  const timeout = nextGatherStep({ startedAt: START, now: Date.parse(START) + GATHER_TIMEOUT_MS + 1, pending });
  assert.deepEqual(timeout, { action: 'proceed', reason: 'timeout' });
  const settled = nextGatherStep({
    startedAt: START, now: Date.parse(START) + 60_000,
    pending: [classifyFacts('AAA', DAY, null, DAY)],
  });
  assert.deepEqual(settled, { action: 'proceed', reason: 'settled' });
});

test('reuses only completed same-input same-day current-workflow runs', () => {
  const row = { status: 'completed', workflowVersion: 9, shortlist: ['B', 'A'], dataAsOf: DAY };
  assert.equal(canReuseRun(row, ['A', 'B'], DAY, 9), true);
  assert.equal(canReuseRun({ ...row, status: 'failed' }, ['A', 'B'], DAY, 9), false);
  assert.equal(canReuseRun({ ...row, workflowVersion: 8 }, ['A', 'B'], DAY, 9), false);
  assert.equal(canReuseRun({ ...row, dataAsOf: '2026-09-28' }, ['A', 'B'], DAY, 9), false);
  assert.equal(canReuseRun(row, ['A'], DAY, 9), false);
});

test('overlayQuote applies a newer cached price and rescales P/E', () => {
  const facts = parseCompanyPage(readFileSync(new URL('./fixtures/psx-luck.html', import.meta.url), 'utf8'), 'LUCK', '2026-09-25T12:00:00Z');
  const newer = { price: facts.price * 1.1, quoteDate: '2026-09-28', fetchedAt: '2026-09-28T10:00:00Z' };
  const overlaid = overlayQuote(facts, newer);
  assert.equal(overlaid.price, newer.price);
  assert.equal(overlaid.priceDate, '2026-09-28');
  assert.ok(Math.abs(overlaid.peTtm - facts.peTtm * 1.1) < 0.02);
  assert.equal(overlayQuote(facts, { ...newer, quoteDate: '2026-09-20' }), facts, 'older quote ignored');
  assert.equal(overlayQuote(facts, { ...newer, fetchedAt: '2026-09-25T00:00:00Z' }), facts, 'older fetch ignored');
  assert.equal(overlayQuote(facts, undefined), facts);
});
