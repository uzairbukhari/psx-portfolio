import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  BUDGET_USD, FORMAT_RESERVE, REPAIR_RESERVE, RESEARCH_RESERVE,
  makeBatches, parseCompanyEvidence, resolveComparison,
} from '../lib/recommendation-evidence.ts';

const base = new URL('../', import.meta.url);
const code = readFileSync(new URL('app/api/recommendations/route.ts', base), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = { OPENAI_API_KEY: "mock-test-key" };')
  .replace("import { db, failure, identity } from '@/lib/server';", `const db=()=>globalThis.__recommendationDB; const identity=async(req,write=false)=>{if(write&&req.headers.get('origin')!==new URL(req.url).origin)throw Error('Invalid request origin.');return req.headers.get('x-test-user')||'owner'}; const failure=(e,status=400)=>Response.json({error:e.message},{status});`)
  .replaceAll("'@/lib/portfolio'", `'${new URL('lib/portfolio.ts', base).href}'`)
  .replaceAll("'@/lib/monthly-picks'", `'${new URL('lib/monthly-picks.ts', base).href}'`)
  .replaceAll("'@/lib/recommendation-evidence'", `'${new URL('lib/recommendation-evidence.ts', base).href}'`);
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tickers = Array.from({ length: 15 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`);
const categories = ['financial', 'valuation', 'development', 'risk'];

function companyEvidence(ticker, complete = true) {
  return {
    ticker, name: `Company ${ticker}`, assessmentStatus: complete ? 'assessed' : 'unassessed',
    summary: `${ticker} evidence summary.`, latestPublishedPeriod: 'H1 2026',
    evidenceGap: complete ? '' : 'Valuation evidence is unavailable.',
    claims: categories.filter(category => complete || category !== 'valuation').map(category => ({
      category, kind: category === 'risk' ? 'inference' : 'reported_fact', claim: `${ticker} ${category}`,
      support: category === 'valuation'
        ? `Market price Rs 100.00 and P/E 8.5x for ${ticker}.`
        : `Published support for ${ticker} ${category}.`,
      sourceUrl: `https://example.com/${ticker}/${category}`, sourceDate: '2026-09-01',
    })),
  };
}
function researchEnvelope(companies) {
  const sources = companies.flatMap(company => company.claims.map(claim => ({ url: claim.sourceUrl, title: `${company.ticker} ${claim.category}` })));
  return { status: 'completed', usage: { input_tokens: 1000, output_tokens: 500 }, output: [
    { type: 'web_search_call', action: { type: 'search', sources } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ companies }) }] },
  ] };
}
function comparisonEnvelope(request) {
  const input = JSON.parse(request.input);
  const assessed = new Map(input.evidence.filter(company => company.assessmentStatus === 'assessed').map(company => [company.ticker, company]));
  const first = assessed.values().next().value;
  const picks = first ? [{
    ticker: first.ticker, name: first.name, allocationPct: 60, confidence: 'Medium', thesis: 'Best supported setup.',
    whySelected: 'Balanced trajectory, valuation, catalyst and risk.', invalidation: 'Published results reverse the thesis.',
    catalysts: ['Published development'], risks: ['Published risk'], sourceIds: first.sourceIds,
  }] : [];
  const value = {
    marketOutlook: 'Selective.', picks,
    coverage: input.evidence.map(company => ({
      ticker: company.ticker,
      outlook: company.assessmentStatus === 'assessed' ? 'Neutral' : 'Insufficient evidence',
      summary: company.summary, sourceIds: company.assessmentStatus === 'assessed' ? company.sourceIds : [],
      assessmentStatus: company.assessmentStatus, evidenceGap: company.evidenceGap,
    })),
    unallocatedPct: first ? 40 : 100,
  };
  return { status: 'completed', usage: { input_tokens: 500, output_tokens: 200 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

let sql;
function setup(t, { repairSucceeds = true, failSubmission = false, failRepairOnce = false } = {}) {
  sql = new DatabaseSync(':memory:');
  for (const migration of ['0009_monthly_picks.sql', '0010_recommendation_evidence.sql', '0011_gray_zemo.sql']) sql.exec(readFileSync(new URL(`drizzle/${migration}`, base), 'utf8').replaceAll('--> statement-breakpoint', ''));
  sql.exec('CREATE TABLE portfolios(user_id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE ai_usage(id TEXT PRIMARY KEY,user_id TEXT,source TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cached_tokens INTEGER,cost_usd REAL,created_at TEXT)');
  sql.prepare('INSERT INTO portfolios VALUES (?,?)').run('owner', JSON.stringify({ companies: tickers.map(ticker => ({ ticker, name: `Company ${ticker}` })) }));
  const prepare = query => { let args=[]; return { bind(...values){args=values;return this}, async first(){return sql.prepare(query).get(...args)??null}, async all(){return {results:sql.prepare(query).all(...args)}}, async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}}} } };
  globalThis.__recommendationDB = { prepare, async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}} };
  const originalFetch = globalThis.fetch;
  const requests = [], responses = new Map(); let repairAttempts = 0;
  globalThis.fetch = async (url, options={}) => {
    if (options.method === 'POST') {
      if (failSubmission) throw Error('timeout');
      const request=JSON.parse(options.body); requests.push(request); const id=`resp_${requests.length}`;
      if (request.tools) {
        const input=JSON.parse(request.input);
        const isRepair=Array.isArray(input.issues);
        if (isRepair) repairAttempts++;
        const companies=input.companies.map(company => companyEvidence(company.ticker, !isRepair || repairSucceeds || company.ticker !== 'T15'));
        if (!isRepair && companies.some(company => company.ticker === 'T15')) companies[companies.findIndex(company => company.ticker === 'T15')] = companyEvidence('T15', false);
        const envelope=researchEnvelope(companies);
        responses.set(id,failRepairOnce&&isRepair&&repairAttempts===1?{...envelope,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}:envelope);
      } else responses.set(id,comparisonEnvelope(request));
      return Response.json({id,status:'in_progress'});
    }
    const id=new URL(url).pathname.split('/').at(-1); return Response.json({...responses.get(id),id});
  };
  t.after(()=>{globalThis.fetch=originalFetch;sql.close();delete globalThis.__recommendationDB});
  return {requests};
}
const post = async (body, owner='owner') => { const response=await route.POST(new Request('https://test/api/recommendations',{method:'POST',headers:{origin:'https://test','Content-Type':'application/json','x-test-user':owner},body:JSON.stringify(body)})); return {status:response.status,body:await response.json()} };
const get = async (id, owner='owner') => { const response=await route.GET(new Request(`https://test/api/recommendations?id=${id}`,{headers:{'x-test-user':owner}})); return {status:response.status,body:await response.json()} };
async function finish(id, limit=12) { let result; for(let index=0;index<limit;index++){result=await get(id);if(!['queued','in_progress'].includes(result.body.status))return result.body} throw Error('workflow did not finish') }

test('15 companies use deterministic five-company batches within the $1 reservation', () => {
  assert.deepEqual(makeBatches(tickers).map(batch => batch.length), [5,5,5]);
  assert.ok(FORMAT_RESERVE + RESEARCH_RESERVE * 3 + REPAIR_RESERVE <= BUDGET_USD);
});

test('claim evidence rejects registered but unrelated company URLs', () => {
  const alpha=companyEvidence('T01'); const beta=companyEvidence('T02');
  alpha.claims[0].sourceUrl=beta.claims[0].sourceUrl;
  const parsed=parseCompanyEvidence([researchEnvelope([alpha,beta])],['T01','T02']);
  assert.equal(parsed.evidence[0].assessmentStatus,'unassessed');
  assert.match(parsed.evidence[0].evidenceGap,/Missing supported financial evidence/);
});

test('generic PSX pages do not count as company-specific evidence', () => {
  const alpha=companyEvidence('T01');
  alpha.claims[0].sourceUrl='https://dps.psx.com.pk/indices/KSE100';
  const envelope=researchEnvelope([alpha]);
  envelope.output[0].action.sources[0].title='KSE 100 index';
  const parsed=parseCompanyEvidence([envelope],['T01']);
  assert.equal(parsed.evidence[0].assessmentStatus,'unassessed');
  assert.match(parsed.evidence[0].evidenceGap,/Missing supported financial evidence/);
});

test('valuation placeholders and stale catalysts cannot make a company assessable', () => {
  const placeholder=companyEvidence('T01');
  placeholder.claims.find(claim=>claim.category==='valuation').support='The filing does not provide market price; calculate valuation later.';
  const stale=companyEvidence('T02');
  stale.claims.find(claim=>claim.category==='development').sourceDate='2025-03-01';
  const parsed=parseCompanyEvidence([researchEnvelope([placeholder,stale])],['T01','T02'],'2026-09-25');
  assert.equal(parsed.evidence[0].assessmentStatus,'unassessed');
  assert.equal(parsed.evidence[1].assessmentStatus,'unassessed');
  assert.match(parsed.evidence[0].evidenceGap,/Missing supported valuation evidence/);
  assert.match(parsed.evidence[1].evidenceGap,/Missing supported development evidence/);
});

test('stale financial evidence cannot substitute for the latest published period', () => {
  const stale=companyEvidence('T01');
  stale.claims.find(claim=>claim.category==='financial').sourceDate='2026-04-01';
  const parsed=parseCompanyEvidence([researchEnvelope([stale])],['T01'],'2026-09-25');
  assert.equal(parsed.evidence[0].assessmentStatus,'unassessed');
  assert.match(parsed.evidence[0].evidenceGap,/Missing supported financial evidence/);
});

test('batches, targeted auto-repair, and final comparison complete without duplicate charges', async t => {
  const mock=setup(t); const started=await post({month:'2026-09',amount:100000,feePct:0,shortlist:tickers});
  assert.equal(started.status,200); assert.equal(started.body.workflowVersion,7);
  const result=await finish(started.body.id);
  assert.equal(result.status,'completed'); assert.equal(result.result.assessedCount,15);
  assert.equal(mock.requests.filter(request=>request.tools).length,4);
  assert.equal(mock.requests.filter(request=>!request.tools).length,1);
  assert.deepEqual(mock.requests.slice(0,3).map(request=>JSON.parse(request.input).companies.length),[5,5,5]);
  const repairInput=JSON.parse(mock.requests[3].input);
  assert.deepEqual(repairInput.companies.map(company=>company.ticker),['T15']);
  await get(started.body.id); assert.equal(mock.requests.length,5);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_usage').get().n,5);
  assert.ok(result.budgetCommittedUsd<=1);
});

test('failed targeted repair yields a usable partial recommendation', async t => {
  setup(t,{repairSucceeds:false}); const started=await post({month:'2026-09',amount:100000,feePct:0,shortlist:tickers});
  const result=await finish(started.body.id);
  assert.equal(result.status,'completed_partial'); assert.equal(result.result.assessedCount,14);
  assert.equal(result.result.coverage.find(company=>company.ticker==='T15').outlook,'Insufficient evidence');
  assert.ok(result.result.picks.every(pick=>pick.ticker!=='T15'));
});

test('a repair stopped by its output ceiling can resume from saved evidence', async t => {
  const mock=setup(t,{failRepairOnce:true}); const started=await post({month:'2026-09',amount:100000,feePct:0,shortlist:tickers});
  let result=await finish(started.body.id);
  assert.equal(result.status,'needs_attention'); assert.equal(result.canRepair,true);
  const resumed=await post({id:started.body.id,action:'repair',confirmPaidRepair:true});
  assert.equal(resumed.status,200); assert.equal(resumed.body.status,'in_progress');
  result=await finish(started.body.id);
  assert.equal(result.status,'completed'); assert.equal(result.result.assessedCount,15);
  assert.equal(mock.requests.filter(request=>request.tools).length,5);
  assert.ok(result.budgetCommittedUsd<=1);
});

test('unsupported picks are removed and their allocation remains cash', () => {
  const alpha=companyEvidence('T01'); const beta=companyEvidence('T02');
  const parsed=parseCompanyEvidence([researchEnvelope([alpha,beta])],['T01','T02']);
  const bad={marketOutlook:'Selective.',picks:[{ticker:'T01',name:'Alpha',allocationPct:60,confidence:'Medium',thesis:'Bad citation.',whySelected:'',invalidation:'',catalysts:[],risks:[],sourceIds:beta.claims.map((_,i)=>parsed.evidence[1].sourceIds[i])}],coverage:parsed.evidence.map(company=>({ticker:company.ticker,outlook:'Neutral',summary:'',sourceIds:company.sourceIds,assessmentStatus:'assessed',evidenceGap:''})),unallocatedPct:40};
  const result=resolveComparison(bad,['T01','T02'],parsed.sources,parsed.evidence);
  assert.equal(result.picks.length,0); assert.equal(result.unallocatedPct,100);
});

test('submission uncertainty retains its reservation and never retries automatically', async t => {
  const mock=setup(t,{failSubmission:true}); const started=await post({month:'2026-09',amount:100000,feePct:0,shortlist:tickers.slice(0,2)});
  assert.equal(started.body.status,'needs_attention');
  await get(started.body.id); assert.equal(mock.requests.length,0);
  assert.ok(started.body.budgetCommittedUsd>0);
});

test('user isolation, origin protection, and shortlist validation remain enforced', async t => {
  setup(t); const started=await post({month:'2026-09',amount:100000,feePct:0,shortlist:tickers.slice(0,2)});
  assert.equal((await get(started.body.id,'other')).status,404);
  assert.equal((await post({month:'2026-09',amount:1,shortlist:['UNKNOWN']})).status,400);
  const response=await route.POST(new Request('https://test/api/recommendations',{method:'POST',headers:{origin:'https://evil'},body:'{}'}));
  assert.equal(response.status,400);
});
