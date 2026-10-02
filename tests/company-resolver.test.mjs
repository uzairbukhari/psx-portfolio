import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { lookupCompanies, cleanLookupTickers } from '../lib/company-resolver.ts';
import { companyStatus, requestCompanyLookup, COMPANY_LOOKUP_LIMIT } from '../lib/company-api.ts';
import { enrichForSave, overlayForRead, queueBackgroundLookups, LOOKUP_RETRY_MS } from '../lib/company-save.ts';
import { hasPlaceholderDetails } from '../lib/company-enrichment.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { canSaveCompany, createLatest, nextLookupAction } from '../lib/company-lookup-client.ts';

const config = { token: 't', repo: 'o/r', appEnv: 'production' };
const counting = () => { const calls = []; const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; }; fetcher.calls = calls; return fetcher; };
function seed(db) {
  db.sqlite.prepare("INSERT INTO security_catalog (ticker,name,source,first_seen_at,last_seen_at,sector_name,sector_code,name_source,sector_source,resolution_status,security_type,face_value) VALUES ('MEBL','Meezan Bank Limited','profile','x','x','COMMERCIAL BANKS','0807','profile','profile','resolved','equity',10)").run();
  db.sqlite.prepare("INSERT INTO security_catalog (ticker,name,source,first_seen_at,last_seen_at,resolution_status) VALUES ('HALF','HALF','all-share','x','x','incomplete')").run();
  db.sqlite.prepare("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('LUCK','2026-10-01',?, 'x')").run(JSON.stringify({ name: 'Lucky Cement Limited', sector: 'CEMENT' }));
  db.sqlite.prepare("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('FAKE','2026-10-01',?, 'x')").run(JSON.stringify({ name: 'FAKE', sector: 'Unknown' }));
}
const company = (ticker, name = ticker, sector = '') => ({ ticker, name, sector, target: 0, approved: false, screenDate: '', note: '' });
const portfolioWith = (...companies) => { const p = blankPortfolio(); p.companies.push(...companies); return p; };

test('a cached ticker resolves from the directory with no upstream request', async () => {
  const db = createD1(); seed(db);
  const fetcher = counting();
  const res = await companyStatus(db, 'mebl,LUCK', config);
  assert.equal(fetcher.calls.length, 0);
  const [mebl, luck] = res.companies;
  assert.deepEqual([mebl.state, mebl.source, mebl.company.name, mebl.company.sector, mebl.company.faceValue], ['resolved', 'directory', 'Meezan Bank Limited', 'Commercial Banks', 10]);
  assert.deepEqual([luck.state, luck.source, luck.company.sector], ['resolved', 'facts', 'Cement']);
});

test('read-only status never dispatches, even for unknown symbols; placeholder facts are not evidence', async () => {
  const db = createD1(); seed(db);
  const res = await companyStatus(db, ['NOPE', 'FAKE', 'HALF'], config);
  assert.deepEqual(res.companies.map((c) => [c.state, c.canRequest]), [['unresolved', true], ['unresolved', true], ['unresolved', true]]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_requests').get().n, 0);
  assert.ok(res.companies.every((c) => c.company === null));
  assert.ok(res.companies.every((c) => !/github|PSX answered|\d{3}/i.test(c.message)), 'messages stay user-safe');
});

test('unknown tickers queue exactly one lookup even when requested concurrently', async () => {
  const db = createD1(); seed(db);
  const fetcher = counting();
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => requestCompanyLookup(db, `u${i}@x`, ['NOPE', 'nope', 'MEBL'], config, fetcher)));
  assert.equal(fetcher.calls.length, 1);
  assert.deepEqual(fetcher.calls[0].body.inputs, { tickers: 'NOPE', mode: 'incremental' }, 'resolved MEBL is not looked up');
  assert.equal(results.filter((r) => r.queued.length).length, 1);
  assert.ok(results.every((r) => r.companies.find((c) => c.ticker === 'NOPE').state === 'pending'));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM refresh_requests WHERE kind='company'").get().n, 1);
  // a repeat while in flight stays folded
  await requestCompanyLookup(db, 'a@x', ['NOPE'], config, fetcher);
  assert.equal(fetcher.calls.length, 1);
});

test('lookup requests are validated, rate limited and disabled safely without dispatch config or on staging', async () => {
  const db = createD1(); seed(db);
  await assert.rejects(requestCompanyLookup(db, 'a@x', ['bad symbol!'], config, counting()), /valid PSX symbol/);
  const noConfig = await requestCompanyLookup(db, 'a@x', ['NOPE'], {}, counting());
  assert.match(noConfig.message, /not available/);
  assert.equal(noConfig.dispatchEnabled, false);
  const fetcher = counting();
  const staging = await requestCompanyLookup(db, 'a@x', ['NOPE'], { ...config, appEnv: 'staging' }, fetcher);
  assert.equal(fetcher.calls.length, 0, 'staging never dispatches the production-writing workflow');
  assert.deepEqual(staging.queued, []);
  for (let i = 0; i < COMPANY_LOOKUP_LIMIT.max; i++) await requestCompanyLookup(db, 'busy@x', [`T${i}AA`], config, counting());
  await assert.rejects(requestCompanyLookup(db, 'busy@x', ['LASTONE'], config, counting()), (e) => e.status === 429);
  assert.deepEqual(cleanLookupTickers('a1,A1,,toolongtickername1'), ['A1']);
});

test('a failed or timed-out lookup is reported honestly and can be retried', async () => {
  const db = createD1(); seed(db);
  const fetcher = counting();
  await requestCompanyLookup(db, 'a@x', ['NOPE'], config, fetcher, Date.parse('2026-10-02T10:00:00Z'));
  db.sqlite.prepare("UPDATE refresh_requests SET status='failed', error='520 from PSX' WHERE ticker='NOPE'").run();
  const failed = (await lookupCompanies(db, ['NOPE']))[0];
  assert.equal(failed.state, 'unresolved');
  assert.ok(!/520/.test(failed.message));
  assert.equal(failed.canRequest, true);
  const retry = await requestCompanyLookup(db, 'a@x', ['NOPE'], config, fetcher, Date.parse('2026-10-02T11:00:00Z'));
  assert.deepEqual(retry.queued, ['NOPE']);
  // a request that never finished times out instead of staying pending forever
  const late = (await lookupCompanies(db, ['NOPE'], Date.parse('2026-10-02T13:00:00Z')))[0];
  assert.equal(late.state, 'unresolved');
});

test('imports keep valid trades; placeholders are filled when resolved, otherwise kept and looked up once', async () => {
  const db = createD1(); seed(db);
  const fetcher = counting();
  const incoming = portfolioWith(company('MEBL'), company('NOPE'));
  incoming.trades.push({ id: 't1', ticker: 'NOPE', kind: 'buy', date: '2026-01-02', shares: 10, price: 5, fees: 0, month: '', note: '' });
  const result = await enrichForSave(db, config, null, incoming, [], Date.now(), fetcher);
  assert.deepEqual(incoming.companies.map((c) => [c.ticker, c.name, c.sector]), [['MEBL', 'Meezan Bank Limited', 'Commercial Banks'], ['NOPE', 'NOPE', '']]);
  assert.equal(incoming.trades.length, 1, 'the trade survives unresolved metadata');
  assert.deepEqual(result.pending, ['NOPE']);
  assert.deepEqual(result.queued, ['NOPE']);
  // saving again does not re-dispatch while the lookup is in flight (duplicate imports are idempotent)
  const again = await enrichForSave(db, config, incoming, structuredClone(incoming), [], Date.now(), fetcher);
  assert.deepEqual(again.queued, []);
  assert.equal(fetcher.calls.length, 1);
  // after a failure, a later save does not hammer the lookup before the retry window passes
  db.sqlite.prepare("UPDATE refresh_requests SET status='failed', completed_at=? WHERE ticker='NOPE'").run(new Date(Date.now() - 1000).toISOString());
  assert.deepEqual(await queueBackgroundLookups(db, config, ['NOPE'], Date.now(), fetcher), []);
  assert.deepEqual(await queueBackgroundLookups(db, config, ['NOPE'], Date.now() + LOOKUP_RETRY_MS + 5000, fetcher), ['NOPE']);
});

test('AHL and Finqalab placeholders for the same ticker resolve to the same master record', async () => {
  const db = createD1(); seed(db);
  const ahl = portfolioWith({ ...company('MEBL'), source: 'ahl' });
  const finqalab = portfolioWith({ ...company('MEBL'), source: 'finqalab' });
  await enrichForSave(db, config, null, ahl, [], Date.now(), counting());
  await enrichForSave(db, config, null, finqalab, [], Date.now(), counting());
  assert.deepEqual([ahl.companies[0].name, ahl.companies[0].sector], [finqalab.companies[0].name, finqalab.companies[0].sector]);
});

test('existing companies keep intentional edits and account settings; only placeholders are repaired', async () => {
  const db = createD1(); seed(db);
  const previous = portfolioWith({ ...company('MEBL', 'My Meezan', 'Banks'), target: 12, approved: true, note: 'keep', faceValue: 5 }, company('LUCK'));
  const incoming = structuredClone(previous);
  const result = await enrichForSave(db, config, previous, incoming, [], Date.now(), counting());
  assert.deepEqual(result.repaired, ['LUCK']);
  const [mebl, luck] = incoming.companies;
  assert.deepEqual([mebl.name, mebl.sector, mebl.target, mebl.approved, mebl.note, mebl.faceValue], ['My Meezan', 'Banks', 12, true, 'keep', 5]);
  assert.deepEqual([luck.name, luck.sector], ['Lucky Cement Limited', 'Cement']);
});

test('a GET repairs placeholders in memory without any write', async () => {
  const db = createD1(); seed(db);
  const p = portfolioWith(company('MEBL'), company('NOPE'));
  const writes = []; const spy = { ...db, prepare: (sql) => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql); return db.prepare(sql); }, batch: db.batch };
  const pending = await overlayForRead(spy, p);
  assert.deepEqual(pending, ['NOPE']);
  assert.equal(p.companies[0].name, 'Meezan Bank Limited');
  assert.equal(writes.length, 0);
});

test('strict Add Company: refuses unresolved symbols, existing tickers and foreign tickers; takes directory values when resolved', async () => {
  const db = createD1(); seed(db);
  const fetcher = counting();
  const blocked = portfolioWith(company('NOPE', 'Typed Name', 'Cement'));
  await assert.rejects(enrichForSave(db, config, null, blocked, ['NOPE'], Date.now(), fetcher), (e) => e.status === 422 && /not available yet/.test(e.message));
  const resolved = portfolioWith(company('MEBL', 'Typed Name', 'Cement'));
  await enrichForSave(db, config, null, resolved, ['MEBL'], Date.now(), fetcher);
  assert.deepEqual([resolved.companies[0].name, resolved.companies[0].sector], ['Meezan Bank Limited', 'Commercial Banks'], 'typed values cannot override the directory');
  const previous = portfolioWith(company('MEBL', 'Meezan Bank Limited', 'Commercial Banks'));
  await assert.rejects(enrichForSave(db, config, previous, structuredClone(previous), ['MEBL']), /already in your portfolio/);
  await assert.rejects(enrichForSave(db, config, null, portfolioWith(company('MEBL')), ['ZZZZ']), /not part of this save/);
  // an old client sends no intent: the same unresolved symbol is saved tolerantly
  await enrichForSave(db, config, null, portfolioWith(company('NOPE', 'Typed Name', 'Cement')), [], Date.now(), fetcher);
});

test('applyLookups and placeholder detection', () => {
  assert.equal(hasPlaceholderDetails({ ticker: 'A1', name: 'a1', sector: 'Cement' }), true);
  assert.equal(hasPlaceholderDetails({ ticker: 'A1', name: 'Alpha', sector: '' }), true);
  assert.equal(hasPlaceholderDetails({ ticker: 'A1', name: 'Alpha', sector: 'Cement' }), false);
});

test('client lookup rules: stale replies are dropped, unknown symbols are requested once, save needs resolved details', () => {
  const guard = createLatest();
  const first = guard.next();
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false, 'a late reply for the previous symbol cannot populate the new one');
  assert.equal(guard.isCurrent(second), true);
  const unknown = { ticker: 'X1', state: 'unresolved', company: null, source: null, message: '', canRequest: true };
  assert.equal(nextLookupAction(unknown, false), 'request');
  assert.equal(nextLookupAction(unknown, true), 'show');
  assert.equal(nextLookupAction({ ...unknown, state: 'pending', canRequest: false }, true), 'poll');
  assert.equal(nextLookupAction({ ...unknown, state: 'resolved' }, false), 'show');
  assert.equal(canSaveCompany({ state: 'resolved', company: { name: 'A', sector: 'B' } }), true);
  assert.equal(canSaveCompany({ state: 'pending', company: null }), false);
  assert.equal(canSaveCompany({ state: 'resolved', company: { name: 'A', sector: ' ' } }), false);
});
