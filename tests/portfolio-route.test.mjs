import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const base = new URL('../', import.meta.url);
const source = readFileSync(new URL('app/api/portfolio/route.ts', base), 'utf8')
  .replace("import { db, identity, failure } from '@/lib/server';", `const db=()=>globalThis.__portfolioDB; const identity=async()=> 'owner'; const failure=(e,status)=>Response.json({error:e.message},{status:status??e.status??400});`)
  .replace("import { blankPortfolio, validate, type Portfolio } from '@/lib/portfolio';", `import { blankPortfolio, validate } from '${new URL('lib/portfolio.ts', base).href}';`)
  .replace("import { applyFacts, newTickers } from '@/lib/company-enrichment';", `import { applyFacts, newTickers } from '${new URL('lib/company-enrichment.ts', base).href}';`)
  .replace("import { gatherFacts } from '@/lib/company-facts-store';", `const gatherFacts=async()=>[];`)
  .replace("import { mergeQuotes, readQuoteRows } from '@/lib/quote-cache';", `import { mergeQuotes, readQuoteRows } from '${new URL('lib/quote-cache.ts', base).href}';`)
  .replace("import { readAnnouncements } from '@/lib/dividend-announcements';", `import { readAnnouncements } from '${new URL('lib/dividend-announcements.ts', base).href}';`)
  .replace(/from '@\/lib\/([\w-]+)'/g, (_, name) => `from '${new URL(`lib/${name}.ts`, base).href}'`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('portfolio GET does not inject cached quotes for another portfolio ticker', async () => {
  const portfolio = { companies: [{ ticker: 'MEBL' }], trades: [], quotes: {}, budgets: {} };
  const cached = (ticker) => ({ ticker, price: 100, as_of: 'now', quote_date: '2026-09-24', source: `https://dps.psx.com.pk/company/${ticker}`, fetched_at: '2026-09-24T00:00:00Z' });
  let call = 0;
  globalThis.__portfolioDB = { prepare() { return { bind() { return this; }, async first() { return { payload: JSON.stringify(portfolio), revision: 2 }; }, async all() { call++; return { results: [cached('MEBL'), cached('OTHER')] }; } }; } };
  const response = await route.GET(new Request('https://test/api/portfolio'));
  const body = await response.json();
  assert.equal(call, 2, 'one read for the quote cache, one for dividend announcements');
  assert.ok(Array.isArray(body.announcements));
  assert.deepEqual(Object.keys(body.portfolio.quotes), ['MEBL']);
});

test('portfolio GET keeps a newer saved quote over an older cached refresh', async () => {
  const saved = { price: 120, asOf: 'Tue, Sep 29, 2026 10:38 AM', date: '2026-09-29', source: 'x', fetchedAt: '2026-09-29T05:38:00Z' };
  const portfolio = { companies: [{ ticker: 'MEBL' }, { ticker: 'LUCK' }], trades: [], quotes: { MEBL: saved }, budgets: {} };
  const row = (ticker, date, at) => ({ ticker, price: 100, as_of: 'old', quote_date: date, source: 'y', fetched_at: at });
  globalThis.__portfolioDB = { prepare() { return { bind() { return this; }, async first() { return { payload: JSON.stringify(portfolio), revision: 2 }; }, async all() { return { results: [row('MEBL', '2026-09-28', '2026-09-28T11:00:00Z'), row('LUCK', '2026-09-28', '2026-09-28T11:00:00Z')] }; } }; } };
  const body = await (await route.GET(new Request('https://test/api/portfolio'))).json();
  assert.equal(body.portfolio.quotes.MEBL.price, 120);
  assert.equal(body.portfolio.quotes.LUCK.price, 100);
});

test('portfolio PUT rejects an oversized body by bytes, before reading it all', async () => {
  globalThis.__portfolioDB = { prepare() { throw Error('DB must not be touched'); } };
  const big = new Request('https://test/api/portfolio', { method: 'PUT', headers: { 'content-length': '5000000' }, body: 'x' });
  const early = await route.PUT(big);
  assert.equal(early.status, 413);
  // Multi-byte characters: under 4M chars but over 4MB.
  const payload = JSON.stringify({ portfolio: { companies: [], note: 'é'.repeat(2_100_000) }, revision: 0 });
  assert.ok(payload.length < 4_000_000);
  const res = await route.PUT(new Request('https://test/api/portfolio', { method: 'PUT', body: payload }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/);
});

test('portfolio PUT validates after enrichment', async () => {
  let saved = null;
  const db = { prepare(sql) { return { bind(...args) { this.args = args; return this; }, async first() { return null; }, async run() { saved = this.args[1]; return { meta: { changes: 1 } }; } }; } };
  globalThis.__portfolioDB = db;
  const portfolio = { companies: [{ ticker: 'MEBL', name: 'Meezan', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' }], trades: [], quotes: {}, budgets: {} };
  const res = await route.PUT(new Request('https://test/api/portfolio', { method: 'PUT', body: JSON.stringify({ portfolio, revision: 0 }) }));
  assert.equal(res.status, 200);
  assert.ok(saved);
});
