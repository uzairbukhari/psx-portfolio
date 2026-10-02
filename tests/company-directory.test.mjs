import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './helpers/d1.mjs';
import { restLike } from './helpers/d1-rest-like.mjs';
import {
  coverageReport, mergeObservation, parseCompanyProfile, parseListings, parseScreener, parseSymbolsJson, planRun, rowFromStored, DIRECTORY_SELECT,
} from '../lib/company-directory.ts';
import { runDirectory } from '../lib/company-directory-run.ts';
import { catalogRowParams, catalogUpsertSql } from '../lib/security-catalog.ts';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const profilePage = (name, sector) => `<div class="section" id="quote"><div class="quote__name">${name}</div><div class="quote__sector"><span>${sector}</span></div></div>`;
const PROFILES = {
  MEBL: profilePage('Meezan Bank Limited', 'COMMERCIAL BANKS'),
  LUCK: profilePage('Lucky Cement Limited', 'CEMENT'),
  ENGRO: profilePage('Engro Corporation Limited', 'FERTILIZER'),
  NEWCO: profilePage('New Company Limited', 'CEMENT'),
  OLDCO: profilePage('Old Company Limited', 'CEMENT'),
  MIIETF: profilePage('Meezan Pakistan ETF', 'EXCHANGE TRADED FUNDS'),
  LISTONLY: profilePage('Listings Only Limited', 'CEMENT'),
  GONE: profilePage('Gone Limited', 'CEMENT'),
};
function fetcher({ failProfiles = [], failAfter = Infinity, dropSources = [] } = {}) {
  const calls = [];
  let profileCalls = 0;
  const fetchText = async (url) => {
    calls.push(url);
    if (url.endsWith('/screener')) return dropSources.includes('screener') ? Promise.reject(new Error('503 from PSX')) : fixture('psx-screener.html');
    if (url.endsWith('/symbols')) return dropSources.includes('symbols') ? Promise.reject(new Error('503 from PSX')) : fixture('psx-symbols.json');
    if (url.endsWith('/listings')) return dropSources.includes('listings') ? Promise.reject(new Error('503 from PSX')) : fixture('psx-listings.html');
    const ticker = url.split('/').pop();
    if (++profileCalls > failAfter) throw new Error('connection reset');
    if (failProfiles.includes(ticker) || !PROFILES[ticker]) throw new Error('520 from PSX');
    return PROFILES[ticker];
  };
  fetchText.calls = calls;
  return fetchText;
}
const dump = (db) => db.sqlite.prepare('SELECT ticker,name,sector_name,sector_code,security_type,listing_status,resolution_status,name_source FROM security_catalog ORDER BY ticker').all();
const run = (db, fetchText, options) => runDirectory({ d1: restLike(db), fetchText, now: () => '2026-10-02T12:00:00.000Z' }, { mode: 'bootstrap', ...options });

test('screener, symbol list and listings parse into validated observations', () => {
  const screener = parseScreener(fixture('psx-screener.html'));
  assert.equal(screener.rejected, 1);
  const mebl = screener.rows.find((r) => r.ticker === 'MEBL');
  assert.deepEqual([mebl.name, mebl.sectorName, mebl.sectorCode], ['Meezan Bank Limited', 'COMMERCIAL BANKS', '0807']);
  assert.equal(screener.rows.find((r) => r.ticker === 'NEWCO').name, null, 'a blank name is not invented');
  const symbols = parseSymbolsJson(fixture('psx-symbols.json'));
  assert.equal(symbols.rejected, 1);
  assert.equal(symbols.rows.find((r) => r.ticker === 'MIIETF').securityType, 'etf');
  assert.equal(symbols.rows.find((r) => r.ticker === 'MEBL').securityType, 'equity');
  assert.equal(symbols.rows.find((r) => r.ticker === 'OLDCO').securityType, null, 'type is only recorded when PSX states it');
  const listings = parseListings(fixture('psx-listings.html'));
  assert.equal(listings.rows.find((r) => r.ticker === 'GONE').listingStatus, 'delisted');
  assert.equal(listings.rows.find((r) => r.ticker === 'MEBL').listingStatus, 'listed');
  assert.throws(() => parseScreener('<html>nothing</html>'), /no symbol table/);
  assert.throws(() => parseSymbolsJson('<html>'), /not valid JSON/);
  assert.equal(parseCompanyProfile('<div>no identity</div>', 'MEBL'), null);
  assert.equal(parseCompanyProfile(profilePage('MEBL', 'Unknown'), 'MEBL'), null, 'the ticker or "Unknown" is not a name or sector');
});

test('a higher-ranked source is never overwritten by a lower one, and empty values never erase', () => {
  const at = '2026-10-02T12:00:00.000Z';
  const profile = { ticker: 'AAA', name: 'Alpha Limited', sectorName: 'CEMENT', sectorCode: null, securityType: null, listingStatus: null, source: 'profile', sourceUrl: 'u1' };
  const first = mergeObservation(null, profile, at);
  assert.equal(first.row.resolutionStatus, 'resolved');
  const screener = { ...profile, name: 'ALPHA LTD (screener)', sectorName: 'OTHER', sectorCode: '0999', source: 'screener', sourceUrl: 'u2' };
  const second = mergeObservation(first.row, screener, at);
  assert.equal(second.row.name, 'Alpha Limited');
  assert.equal(second.row.sectorName, 'CEMENT');
  assert.equal(second.changed, false);
  const empty = mergeObservation(second.row, { ...screener, name: null, sectorName: null }, at);
  assert.equal(empty.row.name, 'Alpha Limited');
  assert.deepEqual(empty.row.sourceUrls, ['u1', 'u2']);
});

test('bootstrap discovers every symbol, resolves from profiles and reports coverage', async () => {
  const db = createD1();
  const report = await run(db, fetcher(), { allShareTickers: ['MEBL', 'LUCK', 'ALLSHRONLY'] });
  const rows = dump(db);
  assert.deepEqual(rows.map((r) => r.ticker), ['ENGRO', 'GONE', 'LISTONLY', 'LUCK', 'MEBL', 'MIIETF', 'NEWCO', 'OLDCO']);
  const by = Object.fromEntries(rows.map((r) => [r.ticker, r]));
  assert.equal(by.MEBL.resolution_status, 'resolved');
  assert.equal(by.MEBL.sector_code, '0807');
  assert.equal(by.MIIETF.security_type, 'etf', 'ETFs keep their own row and type');
  assert.equal(by.NEWCO.name, 'New Company Limited', 'name comes from the profile when lists had none');
  assert.equal(by.GONE.listing_status, 'delisted');
  assert.equal(report.discovered, 8);
  assert.equal(report.coverage.resolved, 8);
  assert.deepEqual(report.coverage.screenerOnly, ['MIIETF'], 'a symbol one list shows and the other lacks is a gap');
  assert.ok(report.coverage.allShareOnly.includes('ALLSHRONLY'), 'All-Share alone is reported as a coverage gap');
  assert.ok(report.coverage.listingsOnly.includes('LISTONLY'));
});

test('a repeated run is idempotent and fetches no profile twice', async () => {
  const db = createD1();
  await run(db, fetcher());
  const before = JSON.stringify(db.sqlite.prepare('SELECT * FROM security_catalog ORDER BY ticker').all());
  const f = fetcher();
  const report = await run(db, f);
  assert.equal(report.profilesPlanned, 0);
  assert.equal(f.calls.filter((u) => /\/company\//.test(u)).length, 0);
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM security_catalog ORDER BY ticker').all()), before);
  const incremental = await run(db, fetcher(), { mode: 'incremental' });
  assert.equal(incremental.profilesPlanned, 0, 'nothing new or incomplete means no profile requests');
});

test('an interrupted bootstrap resumes without losing or repeating work', async () => {
  const db = createD1();
  const first = await run(db, fetcher({ failAfter: 3 }), { concurrency: 1 });
  assert.equal(first.profilesFetched, 3);
  assert.equal(first.profilesFailed.length, 5);
  const afterFirst = dump(db);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM security_catalog WHERE profile_fetched_at IS NOT NULL').get().n, 3, 'only fetched profiles are marked done');
  assert.equal(afterFirst.length, 8, 'discovery is saved before any profile work');
  const f = fetcher();
  const second = await run(db, f);
  assert.equal(f.calls.filter((u) => /\/company\//.test(u)).length, 5, 'only the unfinished symbols are fetched');
  assert.equal(second.coverage.resolved, 8);
});

test('failed scrapes keep stored values; repeated failure is reported unresolved, never deleted', async () => {
  const db = createD1();
  await run(db, fetcher());
  const before = dump(db);
  // every list source down: the run refuses to write anything
  await assert.rejects(run(db, fetcher({ dropSources: ['screener', 'symbols', 'listings'] })), /No PSX symbol list/);
  assert.deepEqual(dump(db), before);
  // one source down, a profile fetch failing: rows survive
  await run(db, fetcher({ dropSources: ['screener'], failProfiles: ['MEBL'] }), { mode: 'full' });
  assert.equal(dump(db).find((r) => r.ticker === 'MEBL').name, 'Meezan Bank Limited');
  // a symbol that disappears from every list stays in the directory
  const f = fetcher();
  const original = f;
  const trimmed = async (url) => (/\/(screener|symbols|listings)$/.test(url) ? (await original(url)).replaceAll('LISTONLY', 'ZZZZZ').replaceAll('GONE', 'YYYYY') : original(url));
  await run(db, trimmed, { mode: 'incremental' });
  assert.ok(dump(db).some((r) => r.ticker === 'LISTONLY') && dump(db).some((r) => r.ticker === 'GONE'));
  // a never-resolvable symbol is reported unresolved after repeated failure
  const db2 = createD1();
  for (let i = 0; i < 3; i++) await run(db2, fetcher({ failProfiles: ['NEWCO'] }), { mode: 'incremental' });
  assert.equal(dump(db2).find((r) => r.ticker === 'NEWCO').resolution_status, 'unresolved');
});

test('already verified company facts are reused without a PSX request', async () => {
  const db = createD1();
  db.sqlite.prepare("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('MEBL','2026-10-01',?, '2026-10-01T10:00:00Z')").run(JSON.stringify({ name: 'Meezan Bank Limited', sector: 'COMMERCIAL BANKS' }));
  db.sqlite.prepare("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('LUCK','2026-10-01',?, '2026-10-01T10:00:00Z')").run(JSON.stringify({ name: 'LUCK', sector: 'Unknown' }));
  const f = fetcher();
  const report = await run(db, f);
  const fetched = f.calls.filter((u) => /\/company\//.test(u)).map((u) => u.split('/').pop());
  assert.ok(!fetched.includes('MEBL'));
  assert.ok(fetched.includes('LUCK'), 'placeholder facts (name = ticker, "Unknown") are not evidence');
  assert.equal(report.profilesFromFacts, 1);
});

test('incremental mode fetches only new, changed or incomplete symbols and resolves on-demand requests', async () => {
  const db = createD1();
  await run(db, fetcher());
  // a symbol the lists have never shown can still be looked up on demand
  const report = await run(db, fetcher(), { mode: 'incremental', tickers: ['LISTONLY', 'ZZNEW'] });
  assert.deepEqual(report.requested.map((r) => r.ticker), ['LISTONLY', 'ZZNEW']);
  assert.equal(report.requested[0].status, 'resolved');
  assert.equal(report.requested[1].status, 'incomplete', 'a symbol PSX gave nothing for stays honestly incomplete');
  assert.match(report.requested[1].reason, /520|no name/);
});

test('the All-Share scrape never overwrites a directory-verified name', async () => {
  const db = createD1();
  await run(db, fetcher());
  db.sqlite.prepare(catalogUpsertSql(2)).run(...catalogRowParams({ ticker: 'MEBL', name: 'MEEZAN BANK' }, 'all-share', '2026-10-03T00:00:00Z'), ...catalogRowParams({ ticker: 'FRESH', name: 'Fresh Co' }, 'all-share', '2026-10-03T00:00:00Z'));
  const rows = Object.fromEntries(dump(db).map((r) => [r.ticker, r]));
  assert.equal(rows.MEBL.name, 'Meezan Bank Limited');
  assert.equal(rows.FRESH.name, 'Fresh Co');
  assert.equal(rows.FRESH.resolution_status, 'incomplete');
  assert.equal(db.sqlite.prepare("SELECT last_seen_at FROM security_catalog WHERE ticker='MEBL'").get().last_seen_at, '2026-10-03T00:00:00Z');
});

test('planRun and coverageReport', () => {
  const at = '2026-10-02T12:00:00.000Z';
  const make = (ticker, source) => mergeObservation(null, { ticker, name: `${ticker} Limited`, sectorName: 'CEMENT', sectorCode: null, securityType: null, listingStatus: null, source, sourceUrl: 'u' }, at);
  const merged = [make('AAA', 'profile'), make('BBB', 'screener')];
  assert.deepEqual(planRun(merged, 'incremental').profiles, ['BBB', 'AAA'], 'new symbols need profiles; never-profiled first');
  assert.deepEqual(planRun(merged.map((m) => ({ ...m, created: false, changed: false })), 'incremental').profiles, [], 'unchanged resolved rows need nothing');
  assert.equal(planRun(merged, 'full', { limit: 1 }).profiles.length, 1);
  const report = coverageReport(merged.map((m) => m.row), { screener: ['AAA'], listings: ['BBB'], allShare: ['CCC'] });
  assert.deepEqual([report.screenerOnly, report.listingsOnly, report.allShareOnly], [['AAA'], ['BBB'], ['CCC']]);
});

test('migration keeps existing catalog rows and defaults them to incomplete', () => {
  const db = createD1();
  db.sqlite.prepare(catalogUpsertSql(1)).run(...catalogRowParams({ ticker: 'AAA', name: 'Alpha' }, 'all-share', 'x'));
  const row = rowFromStored(db.sqlite.prepare(`SELECT ${DIRECTORY_SELECT} FROM security_catalog WHERE ticker='AAA'`).get());
  assert.equal(row.resolutionStatus, 'incomplete');
  assert.equal(row.nameSource, null);
});
