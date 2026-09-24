import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { collectSources, comparisonSchema, resolveComparison, CYCLE_RESERVE, researchRequest, comparisonRequest } from '../lib/recommendation-evidence.ts';

const base = new URL('../', import.meta.url);
const code = readFileSync(new URL('app/api/recommendations/route.ts', base), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = { OPENAI_API_KEY: "mock-test-key" };')
  .replace("import { db, failure, identity } from '@/lib/server';", `const db=()=>globalThis.__recommendationDB; const identity=async(req,write=false)=>{ if(write && req.headers.get('origin')!==new URL(req.url).origin) throw Error('Invalid request origin.'); return req.headers.get('x-test-user') || 'owner'; }; const failure=(e,status=400)=>Response.json({error:e.message},{status});`)
  .replaceAll("'@/lib/portfolio'", `'${new URL('lib/portfolio.ts', base).href}'`)
  .replaceAll("'@/lib/monthly-picks'", `'${new URL('lib/monthly-picks.ts', base).href}'`)
  .replaceAll("'@/lib/recommendation-evidence'", `'${new URL('lib/recommendation-evidence.ts', base).href}'`);
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const sourceURL = 'https://psx.com.pk/aaa-results';
const evidence = { status: 'completed', usage: { input_tokens: 1000, output_tokens: 500 }, output: [
  { type: 'web_search_call', action: { type: 'search', sources: [{ url: sourceURL, title: 'AAA latest results' }] } },
  { type: 'message', content: [{ type: 'output_text', text: 'AAA has earnings growth; BBB mixed. Dated evidence and uncertainty.', annotations: [{ type: 'url_citation', url: sourceURL, title: 'Results' }] }] },
] };
const comparison = { marketOutlook: 'Selective.', picks: [{ ticker: 'AAA', name: 'Alpha', allocationPct: 60, confidence: 'Medium', thesis: 'Growth.', catalysts: ['Results'], risks: ['Volatility'], sourceIds: ['S1'] }], coverage: [
  { ticker: 'AAA', outlook: 'Positive', summary: 'Growth.', sourceIds: ['S1'], evidenceStatus: 'ready', evidenceGap: '' },
  { ticker: 'BBB', outlook: 'Neutral', summary: 'Mixed.', sourceIds: ['S1'], evidenceStatus: 'ready', evidenceGap: '' },
], unallocatedPct: 40 };
const envelope = value => ({ status: 'completed', usage: { input_tokens: 500, output_tokens: 200 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
let sql;
function setup(t) {
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('drizzle/0009_monthly_picks.sql', base), 'utf8'));
  sql.exec(readFileSync(new URL('drizzle/0010_recommendation_evidence.sql', base), 'utf8'));
  sql.exec('CREATE TABLE portfolios(user_id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE ai_usage(id TEXT PRIMARY KEY,user_id TEXT,source TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cached_tokens INTEGER,cost_usd REAL,created_at TEXT)');
  sql.prepare('INSERT INTO portfolios VALUES (?,?)').run('owner', JSON.stringify({ companies: [{ ticker: 'AAA', name: 'Alpha' }, { ticker: 'BBB', name: 'Beta' }] }));
  const prepare = query => {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sql.prepare(query).get(...args) ?? null; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      async run() { const r = sql.prepare(query).run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
  };
  globalThis.__recommendationDB = { prepare, async batch(statements) { sql.exec('BEGIN'); try { const r = []; for (const s of statements) r.push(await s.run()); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
  const originalFetch = globalThis.fetch;
  const requests = [], responses = new Map();
  globalThis.fetch = async (url, options={}) => {
    if (options.method === 'POST') {
      const request = JSON.parse(options.body); requests.push(request);
      const id = `resp_${requests.length}`;
      responses.set(id, request.tools ? structuredClone(evidence) : envelope(comparison));
      return Response.json({ id, status: 'in_progress' });
    }
    const id = new URL(url).pathname.split('/').at(-1);
    assert.equal(typeof url, 'string');
    assert.ok(url.includes('include%5B%5D=web_search_call.action.sources'));
    return Response.json({ ...responses.get(id), id });
  };
  t.after(() => { globalThis.fetch = originalFetch; sql.close(); delete globalThis.__recommendationDB; });
  return { requests, responses };
}
const payload = { month: '2026-09', amount: 20000, feePct: 0, shortlist: ['BBB', 'AAA'], rerun: false };
const post = async (body, owner='owner') => {
  const r = await route.POST(new Request('https://test/api/recommendations', { method:'POST',headers:{ origin:'https://test','Content-Type':'application/json','x-test-user':owner },body:JSON.stringify(body) }));
  return { status:r.status, body:await r.json() };
};
const get = async (id, owner='owner') => {
  const r = await route.GET(new Request(`https://test/api/recommendations?id=${id}`, { headers:{'x-test-user':owner} }));
  return { status:r.status,body:await r.json() };
};

test('source registry accepts only provider citation/tool metadata; schema uses IDs', () => {
  const sources=collectSources([{ ...evidence, arbitrary:{url:'https://invented.invalid'} }]);
  assert.equal(sources.length,1);
  assert.equal(sources[0].id,'S1');
  assert.deepEqual(comparisonSchema(['AAA','BBB'],sources).properties.coverage.items.properties.sourceIds.items.enum,['S1']);
  assert.equal(researchRequest({companies:[]}).tool_choice,'required');
  assert.ok(CYCLE_RESERVE * 2 < 1);
});
test('evidence gap preserves company outlook, proposed picks and allocations', () => {
  const value=structuredClone(comparison);
  value.coverage[0].sourceIds=['UNKNOWN'];
  value.picks[0].sourceIds=['UNKNOWN'];
  const r=resolveComparison(value,['AAA','BBB'],collectSources([evidence]));
  assert.equal(r.picks[0].ticker,'AAA'); assert.equal(r.picks[0].allocationPct,60);
  assert.equal(r.coverage[0].outlook,'Positive'); assert.equal(r.unallocatedPct,40);
  assert.ok(r.evidenceIssues.length);
  assert.equal(value.coverage[0].sourceIds[0],'UNKNOWN');
});
test('full route research -> cited comparison -> saved result, without duplicate charges', async t => {
  const mock=setup(t);
  const first=await post(payload); assert.equal(first.status,200);
  const id=first.body.id;
  const duplicate=await post({...payload,shortlist:['AAA','BBB']}); assert.equal(duplicate.body.id,id);
  assert.equal(mock.requests.length,1);
  assert.equal((await get(id)).body.status,'in_progress');
  assert.equal(mock.requests.length,2);
  const result=await get(id); assert.equal(result.body.status,'completed');
  assert.equal(result.body.result.picks[0].sourceUrls[0],sourceURL);
  await get(id); assert.equal(mock.requests.length,2);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_usage').get().n,2);
  assert.equal(sql.prepare('SELECT count(*) n FROM recommendation_attempts WHERE response IS NOT NULL').get().n,2);
  assert.ok(result.body.estimatedCostUsd>0);
});
test('repair is explicit, bounded, re-compares all companies and survives reload', async t => {
  const mock=setup(t); const {body:{id}}=await post(payload);
  await get(id);
  const incomplete=structuredClone(comparison); incomplete.coverage[0].sourceIds=[];
  mock.responses.set('resp_2',envelope(incomplete));
  let r=await get(id); assert.equal(r.body.status,'needs_evidence'); assert.equal(r.body.result.picks.length,1);
  assert.equal((await post({...payload})).body.id,id); assert.equal(mock.requests.length,2);
  assert.equal((await post({id,action:'repair'})).status,400);
  const repairs=await Promise.all([post({id,action:'repair',confirmPaidRepair:true}),post({id,action:'repair',confirmPaidRepair:true})]);
  assert.equal(mock.requests.length,3); assert.ok(repairs.every(r=>r.status===200));
  await get(id); assert.equal(mock.requests.length,4);
  assert.equal(JSON.parse(mock.requests[3].input).companies.length,2);
  r=await get(id); assert.equal(r.body.status,'completed');
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_usage').get().n,4);
  assert.ok(sql.prepare('SELECT sum(reserved_usd) n FROM recommendation_attempts').get().n<1);
  sql.prepare("UPDATE monthly_recommendations SET status='needs_evidence' WHERE id=?").run(id);
  assert.equal((await post({id,action:'repair',confirmPaidRepair:true})).status,400);
});
test('provider timeout retains reservation and never automatically resubmits', async t => {
  setup(t); let calls=0; globalThis.fetch=async()=>{calls++;throw Error('timeout');};
  const r=await post(payload); assert.equal(r.body.status,'needs_attention');
  await get(r.body.id); await post(payload); assert.equal(calls,1);
  assert.ok(sql.prepare('SELECT sum(reserved_usd) n FROM recommendation_attempts').get().n>0);
});
test('malformed completed output retains raw data, sources and usage for repair', async t => {
  const mock=setup(t); const {body:{id}}=await post(payload); await get(id);
  mock.responses.set('resp_2',{ ...envelope(comparison),output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]});
  const r=await get(id); assert.equal(r.body.status,'needs_attention');
  assert.ok(r.body.researchNotes); assert.ok(r.body.estimatedCostUsd>0);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_usage').get().n,2);
});
test('legacy failed response recovers without new generation or removing a company', async t => {
  const mock=setup(t); const date=new Date().toISOString();
  sql.prepare(`INSERT INTO monthly_recommendations (id,user_id,month,amount,fee_pct,shortlist,status,provider_response_id,error,model,created_at,updated_at) VALUES ('legacy','owner','2026-09',20000,0,?,'failed','old_response','The recommendation contains an unverified or missing source for AAA.','gpt-5-mini',?,?)`).run(JSON.stringify(['AAA','BBB']),date,date);
  const legacy=structuredClone(comparison);
  legacy.picks[0].sourceUrls=['https://mismatch.invalid'];
  legacy.coverage.forEach(c=>{c.sourceUrls=[sourceURL];});
  legacy.coverage[0].sourceUrls=['https://mismatch.invalid'];
  // Only one output_text JSON message, plus authoritative search metadata.
  mock.responses.set('old_response',{...envelope(legacy),output:[evidence.output[0],...envelope(legacy).output]});
  const r=await get('legacy'); assert.equal(r.body.status,'needs_evidence');
  assert.equal(r.body.result.picks[0].ticker,'AAA'); assert.equal(r.body.result.unallocatedPct,40);
  assert.equal(mock.requests.length,0);
  await post({action:'recover',id:'legacy'}); assert.equal(mock.requests.length,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_usage').get().n,1);
});
test('user isolation, origin protection, shortlist limits and unknown tickers', async t=>{
  const mock=setup(t); const {body:{id}}=await post(payload);
  assert.equal((await get(id,'other')).status,404);
  assert.equal((await post({action:'repair',id,confirmPaidRepair:true},'other')).status,404);
  assert.equal((await post({...payload,shortlist:['UNKNOWN']})).status,400);
  assert.equal((await post({...payload,shortlist:[]})).status,400);
  assert.equal((await post({...payload,shortlist:Array.from({length:16},(_,i)=>`T${i}`)})).status,400);
  const r=await route.POST(new Request('https://test/api/recommendations',{method:'POST',headers:{origin:'https://evil'},body:JSON.stringify(payload)}));
  assert.equal(r.status,400);assert.equal(mock.requests.length,1);
});

test('comparison uses fresh research instead of repeating obsolete draft diagnostics', () => {
  const old = envelope({ picks: ['obsolete ranking'], evidenceGap: 'Request exact page mappings later' });
  const request = comparisonRequest({companies: ['AAA', 'BBB']}, [old, evidence], ['AAA', 'BBB']);
  const input = JSON.parse(request.input);
  assert.deepEqual(input.notes, ['AAA has earnings growth; BBB mixed. Dated evidence and uncertainty.']);
  assert.ok(!request.input.includes('obsolete ranking'));
  const repair = researchRequest({companies: ['AAA', 'BBB']}, ['AAA: User asks for page mappings; fetch later']);
  assert.ok(!repair.input.includes('fetch later'));
  assert.ok(!repair.input.includes('page mappings'));
  assert.equal(input.sources[0].url, sourceURL);
});
