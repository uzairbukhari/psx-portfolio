import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const base = new URL('../', import.meta.url);
const source = readFileSync(new URL('app/api/portfolio/route.ts', base), 'utf8')
  .replace("import { db, identity, failure } from '@/lib/server';", `const db=()=>globalThis.__portfolioDB; const identity=async()=> 'owner'; const failure=(e,status=400)=>Response.json({error:e.message},{status});`)
  .replace("import { blankPortfolio, validate, type Portfolio } from '@/lib/portfolio';", `import { blankPortfolio, validate } from '${new URL('lib/portfolio.ts', base).href}';`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('portfolio GET does not inject cached quotes for another portfolio ticker', async () => {
  const portfolio = { companies: [{ ticker: 'MEBL' }], trades: [], quotes: {}, budgets: {} };
  const cached = (ticker) => ({ ticker, price: 100, as_of: 'now', quote_date: '2026-09-24', source: `https://dps.psx.com.pk/company/${ticker}`, fetched_at: '2026-09-24T00:00:00Z' });
  let call = 0;
  globalThis.__portfolioDB = { prepare() { return { bind() { return this; }, async first() { return { payload: JSON.stringify(portfolio), revision: 2 }; }, async all() { call++; return { results: [cached('MEBL'), cached('OTHER')] }; } }; } };
  const response = await route.GET(new Request('https://test/api/portfolio'));
  const body = await response.json();
  assert.equal(call, 1);
  assert.deepEqual(Object.keys(body.portfolio.quotes), ['MEBL']);
});
