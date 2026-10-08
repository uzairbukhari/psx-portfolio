import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { dividendRefreshStatus, ipoStatus, requestDividendRefresh, requestIpoLookup } from '../lib/refresh-api.ts';
import { overallState, REQUEST_TIMEOUT_MS, requestRefresh, tickerState } from '../lib/workflow-requests.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { historicalTickers } from '../lib/dividend-history.ts';

const config = { token: 't', repo: 'o/r', appEnv: undefined };
const ok = () => { const calls = []; const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; }; fetcher.calls = calls; return fetcher; };
const eligible = () => historicalTickers(portfolio());
const portfolio = () => {
  const p = blankPortfolio();
  for (const t of ['AAAA', 'BBBB', 'CCCC', 'ZZZZ']) p.companies.push({ ticker: t, name: t, sector: '', target: 0, approved: false, screenDate: '', note: '' });
  // AAAA sold out, BBBB held, CCCC only voided history, ZZZZ no trades
  p.trades.push(
    { id: '1', ticker: 'AAAA', kind: 'buy', date: '2025-01-02', shares: 10, price: 5, fees: 0, month: '', note: '' },
    { id: '2', ticker: 'AAAA', kind: 'sell', date: '2025-02-02', shares: 10, price: 6, fees: 0, month: '', note: '' },
    { id: '3', ticker: 'BBBB', kind: 'buy', date: '2025-01-02', shares: 10, price: 5, fees: 0, month: '', note: '' },
    { id: '4', ticker: 'CCCC', kind: 'buy', date: '2025-01-02', shares: 10, price: 5, fees: 0, month: '', note: '', voided: true },
  );
  return p;
};

test('refresh covers the tickers the client names (sold-out positions included), capped and validated, with no portfolio read', async () => {
  const db = createD1();
  const fetcher = ok();
  const res = await requestDividendRefresh(db, 'u@x', ['AAAA', 'BBBB'], config, fetcher);
  assert.deepEqual(res.tickers, ['AAAA', 'BBBB']);
  assert.deepEqual(fetcher.calls[0].body.inputs.tickers, 'AAAA,BBBB');
  assert.deepEqual(res.queued, ['AAAA', 'BBBB']);
  assert.equal(res.overall, 'queued');
  assert.equal(fetcher.calls.length, 1);
  // no tickers at all
  await assert.rejects(requestDividendRefresh(db, 'u@x', [], config, fetcher), /no companies/);
});

test('a repeat request is deduplicated while one is in flight', async () => {
  const db = createD1();
  const fetcher = ok();
  await requestDividendRefresh(db, 'u@x', eligible(), config, fetcher);
  const again = await requestDividendRefresh(db, 'u@x', eligible(), config, fetcher);
  assert.equal(fetcher.calls.length, 1);
  assert.deepEqual(again.alreadyRunning.sort(), ['AAAA', 'BBBB']);
  assert.deepEqual(again.queued, []);
});

test('a failed dispatch is recorded as failed immediately and never stays in flight', async () => {
  const db = createD1();
  const bad = async () => ({ ok: false, status: 403 });
  const res = await requestDividendRefresh(db, 'u@x', eligible(), config, bad);
  assert.equal(res.overall, 'failed');
  assert.match(res.states[0].error, /GitHub answered 403/);
  assert.match(res.message, /403/);
  // and a retry is allowed straight away
  const fetcher = ok();
  const retry = await requestDividendRefresh(db, 'u@x', eligible(), config, fetcher);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(retry.overall, 'queued');
  assert.equal(retry.states[0].attempts, 2);
  // network error likewise
  const db2 = createD1();
  const boom = async () => { throw new Error('network down'); };
  const res2 = await requestDividendRefresh(db2, 'u@x', eligible(), config, boom);
  assert.equal(res2.overall, 'failed');
  assert.match(res2.states[0].error, /network down/);
});

test('staging never dispatches the production-writing workflow', async () => {
  const db = createD1();
  const fetcher = ok();
  const res = await requestDividendRefresh(db, 'u@x', eligible(), { ...config, appEnv: 'staging' }, fetcher);
  assert.equal(fetcher.calls.length, 0);
  assert.equal(res.dispatchEnabled, false);
  assert.match(res.message, /disabled on staging/);
  assert.equal(res.overall, 'idle');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_requests').get().n, 0);
  const ipo = await requestIpoLookup(db, 'u@x', 'ABCD', { ...config, appEnv: 'staging' }, fetcher);
  assert.equal(fetcher.calls.length, 0);
  assert.equal(ipo.dispatchEnabled, false);
  // missing token/repo is reported, not dispatched
  const none = await requestDividendRefresh(db, 'u@x', eligible(), {}, fetcher);
  assert.match(none.message, /not configured/);
});

test('queued or running requests that never finish are reported as timed out', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const row = (status, ageMs) => ({ kind: 'payouts', ticker: 'AAAA', status, requested_at: new Date(now - ageMs).toISOString(), dispatched_at: null, started_at: null, completed_at: null, attempts: 1, rows_found: null, coverage_from: null, error: null });
  assert.equal(tickerState(row('queued', 60_000), 'AAAA', now).state, 'queued');
  assert.equal(tickerState(row('running', REQUEST_TIMEOUT_MS + 1000), 'AAAA', now).state, 'failed');
  assert.match(tickerState(row('queued', REQUEST_TIMEOUT_MS + 1000), 'AAAA', now).error, /did not finish/);
});

test('status distinguishes empty success from failure and reports partial / stale coverage', async () => {
  const db = createD1();
  const at = '2026-10-02T09:00:00.000Z';
  const insert = db.sqlite.prepare('INSERT INTO refresh_requests (kind,ticker,status,requested_at,completed_at,rows_found,coverage_from,error,attempts) VALUES (?,?,?,?,?,?,?,?,1)');
  insert.run('payouts', 'AAAA', 'completed', at, at, 0, null, null); // fetched fine, no payouts
  insert.run('payouts', 'BBBB', 'failed', at, at, null, null, 'PSX answered 520');
  const status = await dividendRefreshStatus(db, eligible(), config, Date.parse(at) + 60_000);
  const [a, b] = status.states;
  assert.equal(a.state, 'completed');
  assert.equal(a.rowsFound, 0);
  assert.equal(b.state, 'failed');
  assert.equal(b.error, 'PSX answered 520');
  assert.equal(status.overall, 'partial');
  assert.equal(overallState([a]), 'completed');
  assert.equal(overallState([b]), 'failed');
  assert.equal(overallState([a, { ticker: 'X', state: 'none' }]), 'partial');
  assert.equal(overallState([{ ticker: 'X', state: 'none' }]), 'idle');
  // cached announcements stay available alongside a failed refresh
  db.sqlite.prepare("INSERT INTO dividend_announcements (ticker,book_closure_start,announced_on,kind,book_closure_end,period,details,percent,per_share_rs,fetched_at) VALUES ('BBBB','2025-03-20','2025-02-20','cash','2025-03-21','','20%(F) (D)',20,NULL,'2026-09-01T00:00:00Z')").run();
  const withCache = await dividendRefreshStatus(db, eligible(), config, Date.parse(at));
  assert.equal(withCache.announcements.length, 1);
  assert.equal(withCache.states[1].state, 'failed');
});

test('refresh requests are rate limited per account', async () => {
  const db = createD1();
  const fetcher = ok();
  for (let i = 0; i < 6; i++) {
    db.sqlite.exec('DELETE FROM refresh_requests');
    await requestDividendRefresh(db, 'u@x', eligible(), config, fetcher);
  }
  db.sqlite.exec('DELETE FROM refresh_requests');
  await assert.rejects(requestDividendRefresh(db, 'u@x', eligible(), config, fetcher), /limit reached/);
  // another account is unaffected
  await requestDividendRefresh(db, 'other@x', eligible(), config, fetcher);
});

test('IPO lookup: curated is answered without dispatch, unknown symbols dispatch, results are explicit', async () => {
  const db = createD1();
  const fetcher = ok();
  const curated = await requestIpoLookup(db, 'u@x', 'JSRR', config, fetcher);
  assert.equal(fetcher.calls.length, 0);
  assert.equal(curated.lookups[0].status, 'found');
  assert.equal(curated.lookups[0].verification, 'curated');
  const asked = await requestIpoLookup(db, 'u@x', ['ABCD', 'bad ticker!', 'EFGH'], config, fetcher);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0].body.inputs.tickers, 'ABCD,EFGH');
  assert.equal(fetcher.calls[0].url.endsWith('/psx-ipo.yml/dispatches'), true);
  assert.deepEqual(asked.queued, ['ABCD', 'EFGH']);
  assert.equal(asked.lookups[0].status, 'not-found'); // nothing stored yet: explicit, not a silent empty
  db.sqlite.prepare("INSERT INTO ipo_offers (ticker,status,offer_price,listing_date,evidence,verification,checked_at) VALUES ('ABCD','found',25,'2024-05-01','[]','extracted','2026-10-01T00:00:00Z')").run();
  db.sqlite.prepare("INSERT INTO ipo_offers (ticker,status,error,checked_at) VALUES ('EFGH','failed','PSX IPO pages unreadable','2026-10-01T00:00:00Z')").run();
  const status = await ipoStatus(db, 'ABCD,EFGH', config);
  assert.equal(status.lookups[0].status, 'found');
  assert.equal(status.lookups[0].verification, 'extracted');
  assert.equal(status.lookups[1].status, 'failed');
  // at most five symbols per call
  const many = await ipoStatus(db, 'AAAA,BBBB,CCCC,DDDD,EEEE,FFFF,GGGG', config);
  assert.equal(many.lookups.length, 5);
});

test('requestRefresh never exceeds the ticker cap and ignores malformed symbols', async () => {
  const db = createD1();
  const fetcher = ok();
  const many = Array.from({ length: 80 }, (_, i) => `T${String(i).padStart(3, '0')}`);
  const res = await requestRefresh(db, config, 'payouts', [...many, 'bad!', 'lower'], Date.now(), fetcher);
  assert.equal(res.queued.length, 40);
  assert.ok(fetcher.calls[0].body.inputs.tickers.split(',').every((t) => /^[A-Z0-9]{2,12}$/.test(t)));
});

test('a history request dispatches psx-history.yml with no inputs and is deduplicated while in flight', async () => {
  const db = createD1();
  const fetcher = ok();
  const first = await requestRefresh(db, config, 'history', ['MTL'], Date.now(), fetcher);
  assert.deepEqual(first.queued, ['MTL']);
  assert.match(fetcher.calls[0].url, /workflows\/psx-history\.yml\/dispatches$/);
  assert.equal(fetcher.calls[0].body.inputs, undefined);
  const again = await requestRefresh(db, config, 'history', ['MTL'], Date.now(), fetcher);
  assert.equal(fetcher.calls.length, 1);
  assert.deepEqual(again.alreadyRunning, ['MTL']);
});

test('a history request is not dispatched from staging', async () => {
  const res = await requestRefresh(createD1(), { ...config, appEnv: 'staging' }, 'history', ['MTL']);
  assert.equal(res.dispatched, false);
  assert.match(res.reason, /staging/);
});
