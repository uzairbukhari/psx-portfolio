import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { restLike } from './helpers/d1-rest-like.mjs';
import { QUOTE_MESSAGES, deriveQuoteJob, quoteJobStatus, requestQuoteJob } from '../lib/quote-jobs.ts';
import { writeQuotes } from '../lib/quote-cache.ts';
import { completeRequests, computeOutcomes, failRequests, markRunning, readStoredFetchTimes, snapshotOpenRequests } from '../lib/quote-scrape-run.ts';
import { followQuoteJob } from '../lib/quote-refresh-client.ts';
import { readRequests } from '../lib/workflow-requests.ts';

const OPEN = Date.parse('2026-09-29T06:00:00Z'); // Tuesday 11:00 PKT, market open
const CONFIG = { token: 't', repo: 'o/r' };
const quote = (price, fetchedAt, asOf = 'Tue, Sep 29, 2026 10:50 AM') => ({ price, asOf, date: '2026-09-29', source: 'https://dps.psx.com.pk/indices/ALLSHR', fetchedAt });
const okFetch = () => { const calls = []; const fn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }; fn.calls = calls; return fn; };
const seed = async (db, entries) => writeQuotes(db, Object.fromEntries(entries));
const FORBIDDEN = /\b(40\d|50\d|52\d)\b|PSX|scraper|GitHub|Cloudflare|dps\.|Skipped|Refresh limit/i;

test('fresh cache answers at once: no dispatch, "already up to date"', async () => {
  const db = createD1();
  await seed(db, [['MEBL', quote(100, new Date(OPEN - 60_000).toISOString())]]);
  const fetcher = okFetch();
  const { snapshot, job } = await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, fetcher });
  assert.equal(job.state, 'fresh');
  assert.equal(job.message, QUOTE_MESSAGES.fresh);
  assert.equal(fetcher.calls.length, 0);
  assert.equal(snapshot.quotes.MEBL.price, 100);
  assert.deepEqual(snapshot.stale, {});
});

test('stale cache is served immediately and queued once; pending is not shown as a failure', async () => {
  const db = createD1();
  await seed(db, [['MEBL', quote(100, new Date(OPEN - 3_600_000).toISOString())]]);
  const fetcher = okFetch();
  const { snapshot, job } = await requestQuoteJob(db, CONFIG, ['MEBL', 'LUCK'], { now: OPEN, fetcher });
  assert.equal(job.state, 'queued');
  assert.equal(job.message, QUOTE_MESSAGES.pending);
  assert.deepEqual(job.pending.sort(), ['LUCK', 'MEBL']);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0].body.inputs, undefined, 'the quote workflow declares no inputs');
  assert.equal(snapshot.quotes.MEBL.price, 100, 'the old price is still served');
  assert.deepEqual(snapshot.stale, {});
});

test('simultaneous users share one dispatch', async () => {
  const db = createD1();
  const fetcher = okFetch();
  const [a, b] = await Promise.all([
    requestQuoteJob(db, CONFIG, ['MEBL', 'LUCK'], { now: OPEN, fetcher }),
    requestQuoteJob(db, CONFIG, ['LUCK', 'MEBL'], { now: OPEN, fetcher }),
  ]);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(a.job.state, 'queued');
  assert.equal(b.job.state, 'queued');
});

test('missing dispatch configuration (and staging) is unavailable, never a false success', async () => {
  const db = createD1();
  await seed(db, [['MEBL', quote(100, new Date(OPEN - 3_600_000).toISOString())]]);
  for (const config of [{}, { ...CONFIG, appEnv: 'staging' }]) {
    const { snapshot, job } = await requestQuoteJob(db, config, ['MEBL', 'LUCK'], { now: OPEN, fetcher: okFetch() });
    assert.equal(job.state, 'unavailable');
    assert.equal(job.message, QUOTE_MESSAGES.failed);
    assert.equal(snapshot.stale.MEBL, 'Previous price retained.');
    assert.equal(snapshot.failed.LUCK, 'Price not available yet.');
  }
  assert.equal((await readRequests(db, 'quotes', ['MEBL'])).size, 0, 'nothing was queued');
});

test('a refused dispatch fails the job immediately instead of leaving it queued', async () => {
  const db = createD1();
  const { job } = await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, fetcher: async () => new Response('no', { status: 403 }) });
  assert.equal(job.state, 'failed');
  assert.equal(job.message, QUOTE_MESSAGES.failed);
  const row = (await readRequests(db, 'quotes', ['MEBL'])).get('MEBL');
  assert.doesNotMatch(String(job.message), FORBIDDEN);
  assert.equal(row.status, 'failed');
});

test('scraper run: verified outcomes drive completed / partial / failed / fresh', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await requestQuoteJob(db, CONFIG, ['AAA1', 'BBB2', 'CCC3'], { now: OPEN, fetcher: okFetch() });
  const snapshot = await snapshotOpenRequests(d1, OPEN);
  assert.deepEqual([...snapshot.keys()].sort(), ['AAA1', 'BBB2', 'CCC3']);
  await markRunning(d1, snapshot, new Date(OPEN).toISOString());
  assert.equal(deriveQuoteJob(await readRequests(db, 'quotes', ['AAA1']), ['AAA1'], OPEN).state, 'running');

  const fetchedAt = new Date(OPEN + 1000).toISOString();
  const quotes = { AAA1: quote(10, fetchedAt), BBB2: quote(20, fetchedAt) }; // CCC3 could not be priced
  await writeQuotes(db, quotes);
  const stored = await readStoredFetchTimes(d1, ['AAA1', 'BBB2', 'CCC3']);
  const outcomes = computeOutcomes({ targets: snapshot.keys(), quotes, fallback: new Set(['BBB2']), stored });
  assert.deepEqual(outcomes, { AAA1: 'updated', BBB2: 'fallback_used', CCC3: 'failed' });
  await completeRequests(d1, snapshot, outcomes, undefined, new Date(OPEN + 2000).toISOString());
  const rows = await readRequests(db, 'quotes', ['AAA1', 'BBB2', 'CCC3']);
  const partial = deriveQuoteJob(rows, ['AAA1', 'BBB2', 'CCC3'], OPEN + 3000);
  assert.equal(partial.state, 'partial');
  assert.equal(partial.message, QUOTE_MESSAGES.partial);
  assert.equal(deriveQuoteJob(rows, ['AAA1', 'BBB2'], OPEN + 3000).state, 'completed');
  assert.equal(deriveQuoteJob(rows, ['AAA1', 'BBB2'], OPEN + 3000).message, QUOTE_MESSAGES.updated);
  assert.equal(deriveQuoteJob(rows, ['CCC3'], OPEN + 3000).state, 'failed');
  assert.equal(deriveQuoteJob(rows, ['CCC3'], OPEN + 3000).message, QUOTE_MESSAGES.failed);
  assert.equal(rows.get('CCC3').error, 'Prices could not be refreshed.');
});

test('a ticker that is only an old cached quote is not a success', () => {
  const rows = new Map([['MEBL', { kind: 'quotes', ticker: 'MEBL', status: 'completed', requested_at: new Date(OPEN).toISOString(), outcome: null, attempts: 1 }]]);
  assert.equal(deriveQuoteJob(rows, ['MEBL'], OPEN + 1000).state, 'failed');
});

test('all already-current means fresh', () => {
  const at = new Date(OPEN).toISOString();
  const rows = new Map(['A1', 'B2'].map((t) => [t, { kind: 'quotes', ticker: t, status: 'completed', requested_at: at, outcome: 'already_current', attempts: 1 }]));
  const job = deriveQuoteJob(rows, ['A1', 'B2'], OPEN + 1000);
  assert.equal(job.state, 'fresh');
  assert.equal(job.message, QUOTE_MESSAGES.fresh);
});

test('a request that never finishes times out as failed', async () => {
  const db = createD1();
  await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, fetcher: okFetch() });
  const later = OPEN + 21 * 60_000;
  const { job } = await quoteJobStatus(db, ['MEBL'], undefined, later);
  assert.equal(job.state, 'failed');
  assert.equal(job.message, QUOTE_MESSAGES.failed);
  const before = await quoteJobStatus(db, ['MEBL'], undefined, OPEN + 60_000);
  assert.equal(before.job.state, 'queued');
});

test('a complete outage fails every snapshot request with a generic note', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await requestQuoteJob(db, CONFIG, ['MEBL', 'LUCK'], { now: OPEN, fetcher: okFetch() });
  const snapshot = await snapshotOpenRequests(d1, OPEN);
  await failRequests(d1, snapshot);
  const { job } = await quoteJobStatus(db, ['MEBL', 'LUCK'], undefined, OPEN + 1000);
  assert.equal(job.state, 'failed');
  for (const row of (await readRequests(db, 'quotes', ['MEBL', 'LUCK'])).values()) assert.doesNotMatch(row.error, FORBIDDEN);
});

test('a slow run cannot complete a request queued after it started', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, fetcher: okFetch() });
  const snapshot = await snapshotOpenRequests(d1, OPEN);
  // The old request finishes elsewhere, then the user queues a new one while the run is still going.
  db.sqlite.prepare("UPDATE refresh_requests SET requested_at=? WHERE ticker='MEBL'").run(new Date(OPEN + 5000).toISOString());
  await completeRequests(d1, snapshot, { MEBL: 'updated' }, undefined, new Date(OPEN + 6000).toISOString());
  const row = (await readRequests(db, 'quotes', ['MEBL'])).get('MEBL');
  assert.equal(row.status, 'queued', 'the newer request stays open for the next run');
});

test('a delayed dispatch loses nothing: the next scrape serves every open request, even for an unheld ticker', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await requestQuoteJob(db, CONFIG, ['NEWCO'], { now: OPEN, fetcher: async () => new Response(null, { status: 204 }) });
  // The dispatch run never happened; a scheduled run starts later and finds the request.
  const snapshot = await snapshotOpenRequests(d1, OPEN + 8 * 60_000);
  assert.deepEqual([...snapshot.keys()], ['NEWCO']);
});

test('out-of-order cache writes never replace a newer observation and are reported as already current', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await seed(db, [['MEBL', quote(110, new Date(OPEN).toISOString(), 'Tue, Sep 29, 2026 10:55 AM')]]);
  await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, force: true, fetcher: okFetch() });
  const snapshot = await snapshotOpenRequests(d1, OPEN);
  const late = { MEBL: quote(100, new Date(OPEN + 1000).toISOString(), 'Tue, Sep 29, 2026 10:40 AM') };
  await writeQuotes(db, late);
  const stored = await readStoredFetchTimes(d1, ['MEBL']);
  assert.equal(db.sqlite.prepare("SELECT price FROM quote_refreshes WHERE ticker='MEBL'").get().price, 110);
  assert.deepEqual(computeOutcomes({ targets: ['MEBL'], quotes: late, fallback: new Set(), stored }), { MEBL: 'already_current' });
  assert.ok(snapshot.has('MEBL'));
});

test('GET status never dispatches or writes, and `since` ignores older requests', async () => {
  const db = createD1();
  const d1 = restLike(db);
  await requestQuoteJob(db, CONFIG, ['MEBL'], { now: OPEN, fetcher: okFetch() });
  await completeRequests(d1, await snapshotOpenRequests(d1, OPEN), { MEBL: 'updated' }, undefined, new Date(OPEN + 1000).toISOString());
  const status = await quoteJobStatus(db, ['MEBL'], undefined, OPEN + 2000);
  assert.equal(status.job.state, 'completed');
  const after = await quoteJobStatus(db, ['MEBL'], new Date(OPEN + 60_000).toISOString(), OPEN + 2000);
  assert.equal(after.job.state, 'idle');
});

test('user-facing text never carries provider, scraper or status-code detail', async () => {
  const db = createD1();
  await seed(db, [['MEBL', quote(100, new Date(OPEN - 3_600_000).toISOString())]]);
  const { snapshot, job } = await requestQuoteJob(db, {}, ['MEBL', 'LUCK'], { now: OPEN });
  const text = [job.message, ...Object.values(snapshot.stale), ...Object.values(snapshot.failed), ...Object.values(QUOTE_MESSAGES)].join(' | ');
  assert.doesNotMatch(text.replace(/PSX/g, ''), FORBIDDEN);
  assert.deepEqual(Object.values(QUOTE_MESSAGES), [
    'Refreshing market prices…',
    'Market prices refreshed successfully.',
    'Market prices are already up to date.',
    'Some prices could not be refreshed. Previous prices have been retained.',
    'Unable to refresh market prices right now. Please try again later.',
  ]);
});

test('followQuoteJob polls until the job settles, tolerates a dropped poll and stops when cancelled', async () => {
  const pending = (state) => ({ quotes: {}, errors: [], reasons: {}, stale: {}, job: { state, tickers: ['A1'], outcomes: {}, pending: ['A1'], message: QUOTE_MESSAGES.pending, requestedAt: 'T0' } });
  const done = { quotes: {}, errors: [], reasons: {}, stale: {}, job: { state: 'completed', tickers: ['A1'], outcomes: { A1: 'updated' }, pending: [], message: QUOTE_MESSAGES.updated, requestedAt: 'T0' } };
  const sinces = [];
  const script = [pending('running'), 'drop', done];
  const final = await followQuoteJob({
    start: async () => pending('queued'),
    poll: async (since) => { sinces.push(since); const next = script.shift(); if (next === 'drop') throw Error('network'); return next; },
    sleep: async () => {},
  });
  assert.equal(final.job.state, 'completed');
  assert.deepEqual(sinces, ['T0', 'T0', 'T0']);

  let polls = 0;
  const stopped = await followQuoteJob({ start: async () => pending('queued'), poll: async () => { polls++; return pending('queued'); }, sleep: async () => {}, cancelled: () => polls >= 2 });
  assert.equal(stopped.job.state, 'queued');
  assert.equal(polls, 2);

  let clock = 0;
  const limited = await followQuoteJob({ start: async () => pending('queued'), poll: async () => pending('queued'), sleep: async () => { clock += 6 * 60_000; }, now: () => clock });
  assert.equal(limited.job.state, 'queued', 'gives up after the poll limit without claiming success');
});
