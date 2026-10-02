import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './helpers/d1.mjs';
import { parseCompanyPage } from '../lib/company-facts.ts';
import { today } from '../lib/portfolio.ts';
import {
  startRun, advanceRun, claimLease, processDueRuns, picksHealth, readRow, listRuns,
} from '../lib/recommendation-service.ts';

const OWNER = 'owner@example.com';
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function world({ openaiKey, fetch: fakeFetch, tickers = ['LUCK', 'MEBL'], held = [] } = {}) {
  const db = createD1();
  const day = today();
  for (const [ticker, file] of [['LUCK', 'psx-luck.html'], ['MEBL', 'psx-mebl.html']]) {
    const facts = parseCompanyPage(fixture(file), ticker, `${day}T05:00:00Z`);
    db.sqlite.prepare('INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)').run(ticker, day, JSON.stringify(facts), `${day}T05:00:00Z`);
  }
  const portfolio = {
    companies: tickers.map((ticker) => ({ ticker, name: ticker, sector: 'X', target: 10, approved: true, screenDate: day, note: '' })),
    trades: held, quotes: {}, budgets: {}, dividends: [], splits: [], notifications: [],
  };
  db.sqlite.prepare('INSERT INTO portfolios (user_id,payload,revision,updated_at) VALUES (?,?,1,?)').run(OWNER, JSON.stringify(portfolio), new Date().toISOString());
  const env = { db, openaiKey, aiCapUsd: '1', dispatch: {}, fetch: fakeFetch };
  return { db, env };
}
const body = (extra = {}) => ({ month: '2026-10', amount: 100000, feePct: 0.5, shortlist: ['LUCK', 'MEBL'], ...extra });
const activeCount = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM monthly_recommendations WHERE status IN ('queued','gathering','in_progress')").get().n;

async function drive(env, id, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await processDueRuns(env);
    const row = await readRow(env, id, OWNER);
    if (!['queued', 'gathering', 'in_progress'].includes(row.status)) return row;
  }
  return readRow(env, id, OWNER);
}

test('a run reaches a terminal state through the cron processor alone (no client requests)', async () => {
  const { env } = world();
  const started = await startRun(env, OWNER, body());
  // The client "closes" here: nothing but the processor touches the run from now on.
  const row = await drive(env, started.id);
  assert.equal(row.status, 'completed');
  assert.equal(JSON.parse(row.progress).step, 'saved');
  const result = JSON.parse(row.result);
  assert.equal(result.method, 'quant');
  assert.match(result.fallbackReason, /not configured/);
  assert.ok(result.sizing, 'limits were applied and recorded');
});

test('only a persisted success reaches 100 and listRuns exposes the percentage', async () => {
  const { env } = world();
  const started = await startRun(env, OWNER, body());
  const done = await drive(env, started.id);
  const [listed] = await listRuns(env, OWNER);
  assert.equal(listed.id, done.id);
  assert.equal(listed.progress.percent, 100);
});

test('progress never reports 100 before the result is saved', async () => {
  const { env } = world();
  const started = await startRun(env, OWNER, body());
  if (started.status !== 'completed') assert.ok(started.progress.percent < 100);
});

test('concurrent lease claims: at most one worker wins', async () => {
  const { env } = world();
  const started = await startRun(env, OWNER, body({ shortlist: ['LUCK', 'MEBL'], rerun: true }));
  const claims = await Promise.all([claimLease(env, started.id), claimLease(env, started.id), claimLease(env, started.id)]);
  assert.ok(claims.filter(Boolean).length <= 1);
});

test('an expired lease is recovered and the older holder cannot clear the newer lease', async () => {
  const { env, db } = world();
  db.sqlite.prepare("INSERT INTO monthly_recommendations (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,created_at,updated_at) VALUES ('r1',?,'2026-10',1000,0,'[\"LUCK\"]','gathering','m',9,?,?)")
    .run(OWNER, new Date().toISOString(), new Date().toISOString());
  const first = await claimLease(env, 'r1');
  assert.ok(first);
  assert.equal(await claimLease(env, 'r1'), null, 'live lease blocks a second claim');
  db.sqlite.prepare('UPDATE monthly_recommendations SET lease_expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), 'r1');
  const second = await claimLease(env, 'r1');
  assert.ok(second, 'expired lease can be taken over');
  assert.notEqual(second.token, first.token);
  const stale = db.sqlite.prepare('UPDATE monthly_recommendations SET lease_token=NULL WHERE id=? AND lease_token=?').run('r1', first.token);
  assert.equal(Number(stale.changes), 0);
  assert.equal((await readRow(env, 'r1', OWNER)).lease_token, second.token);
});

test('repeated POSTs with one idempotency key return the same run', async () => {
  const { env } = world();
  const a = await startRun(env, OWNER, body({ idempotencyKey: 'key-123456789' }));
  const b = await startRun(env, OWNER, body({ idempotencyKey: 'key-123456789' }));
  assert.equal(a.id, b.id);
});

test('concurrent starts keep a single active run per account', async () => {
  const { env, db } = world();
  const results = await Promise.all([
    startRun(env, OWNER, body({ idempotencyKey: 'aaaaaaaa1' })),
    startRun(env, OWNER, body({ idempotencyKey: 'bbbbbbbb2' })),
  ]);
  assert.ok(activeCount(db) <= 1);
  assert.ok(results.every((r) => r.id));
});

test('a valid cash-only AI answer completes as an AI result with 100% cash', async () => {
  const fakeFetch = async (url, init) => {
    if (init?.method === 'POST') return Response.json({ id: 'resp_1', status: 'queued' });
    const output = JSON.stringify({
      marketOutlook: 'Hold cash.', picks: [],
      coverage: ['LUCK', 'MEBL'].map((ticker) => ({ ticker, outlook: 'Neutral', summary: 'Fair.' })), unallocatedPct: 100,
    });
    return Response.json({ id: 'resp_1', status: 'completed', output: [{ content: [{ type: 'output_text', text: output }] }], usage: { input_tokens: 1000, output_tokens: 200 } });
  };
  const { env } = world({ openaiKey: 'sk-test', fetch: fakeFetch });
  const started = await startRun(env, OWNER, body());
  const row = await drive(env, started.id);
  assert.equal(row.status, 'completed');
  const result = JSON.parse(row.result);
  assert.equal(result.method, 'ai');
  assert.equal(result.picks.length, 0);
  assert.equal(result.unallocatedPct, 100);
});

test('an unconfirmed AI submission keeps its reservation, is never resubmitted, and falls back with the exact reason', async () => {
  let submissions = 0;
  const fakeFetch = async () => { submissions++; throw new Error('network down'); };
  const { env, db } = world({ openaiKey: 'sk-test', fetch: fakeFetch });
  const started = await startRun(env, OWNER, body());
  const row = await drive(env, started.id);
  assert.equal(row.status, 'completed');
  assert.equal(submissions, 1, 'never blindly resubmitted');
  const result = JSON.parse(row.result);
  assert.equal(result.method, 'quant');
  assert.match(result.fallbackReason, /could not be confirmed/);
  const attempt = db.sqlite.prepare('SELECT state,cost_usd,reserved_usd FROM recommendation_attempts').get();
  assert.equal(attempt.state, 'uncertain');
  assert.equal(attempt.cost_usd, attempt.reserved_usd, 'reservation retained as cost');
});

test('the monthly AI cap is enforced and no provider call is made over it', async () => {
  let called = false;
  const { env, db } = world({ openaiKey: 'sk-test', fetch: async () => { called = true; return Response.json({}); } });
  env.aiCapUsd = '0';
  const started = await startRun(env, OWNER, body());
  const row = await drive(env, started.id);
  assert.equal(called, false);
  assert.match(JSON.parse(row.result).fallbackReason, /monthly AI limit/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM recommendation_attempts').get().n, 0);
});

test('a company with no stored facts is reported unassessed while the others complete', async () => {
  const { env } = world({ tickers: ['LUCK', 'MEBL', 'ZZZZ'] });
  const started = await startRun(env, OWNER, body({ shortlist: ['LUCK', 'MEBL', 'ZZZZ'] }));
  const row = await drive(env, started.id);
  assert.equal(row.status, 'completed');
  const result = JSON.parse(row.result);
  assert.equal(result.coverage.find((c) => c.ticker === 'ZZZZ').assessmentStatus, 'unassessed');
  assert.equal(result.assessedCount, 2);
});

test('stale company facts (older than 7 days) cannot support a pick', async () => {
  const { env, db } = world();
  db.sqlite.prepare("UPDATE company_facts SET fetched_on='2020-01-01'").run();
  const started = await startRun(env, OWNER, body());
  const row = await drive(env, started.id);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /days old|No shortlisted company has usable/);
});

test('the watchdog fails a run that exceeds the age ceiling with an explicit reason', async () => {
  const { env, db } = world();
  const started = await startRun(env, OWNER, body());
  db.sqlite.prepare("UPDATE monthly_recommendations SET status='gathering',result=NULL,created_at=?,lease_token=NULL,next_attempt_at=NULL WHERE id=?")
    .run(new Date(Date.now() - 31 * 60_000).toISOString(), started.id);
  await advanceRun(env, started.id);
  const row = await readRow(env, started.id, OWNER);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /30 minutes/);
});

test('health reports stuck runs and points at the missing cron', async () => {
  const { env, db } = world();
  db.sqlite.prepare("INSERT INTO monthly_recommendations (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,created_at,updated_at) VALUES ('r9',?,'2026-10',1000,0,'[\"LUCK\"]','gathering','m',9,?,?)")
    .run(OWNER, new Date(Date.now() - 20 * 60_000).toISOString(), new Date(Date.now() - 20 * 60_000).toISOString());
  const health = await picksHealth(env);
  assert.equal(health.stuckRuns, 1);
  assert.ok(health.warnings.some((w) => /cron/.test(w)));
});

test('holdings are honoured: an overweight existing position receives no new allocation', async () => {
  const day = today();
  const held = [{ id: 't1', ticker: 'MEBL', kind: 'buy', date: '2026-01-05', shares: 1000, price: 500, fees: 0, note: '' }];
  const { env, db } = world({ held });
  const quote = { price: 500, asOf: 'x', date: day, source: 'https://dps.psx.com.pk/company/MEBL', fetchedAt: `${day}T05:00:00Z` };
  db.sqlite.prepare("UPDATE portfolios SET payload=json_set(payload, '$.quotes', json(?))").run(JSON.stringify({ MEBL: quote }));
  // Control: without the holding the same inputs do pick MEBL.
  const control = world();
  const controlRun = await drive(control.env, (await startRun(control.env, OWNER, body({ amount: 10000 }))).id);
  assert.ok(JSON.parse(controlRun.result).picks.some((p) => p.ticker === 'MEBL'), 'control run selects MEBL');
  const row = await drive(env, (await startRun(env, OWNER, body({ amount: 10000 }))).id);
  const result = JSON.parse(row.result);
  assert.ok(!result.picks.some((p) => p.ticker === 'MEBL'), 'MEBL is the whole portfolio, so it gets nothing');
  assert.equal(result.sizing.picks.find((p) => p.ticker === 'MEBL').constrainedBy, 'overweight');
  assert.equal(result.unallocatedPct, 100);
});

test('a completed run is reused only while holdings are unchanged', async () => {
  const day = today();
  const { env, db } = world();
  const first = await drive(env, (await startRun(env, OWNER, body())).id);
  const again = await startRun(env, OWNER, body());
  assert.equal(again.id, first.id, 'same inputs and holdings reuse the saved run');
  const trade = { id: 't1', ticker: 'LUCK', kind: 'buy', date: '2026-01-05', shares: 10, price: 400, fees: 0, note: '' };
  const quote = { price: 400, asOf: 'x', date: day, source: 'https://dps.psx.com.pk/company/LUCK', fetchedAt: `${day}T05:00:00Z` };
  db.sqlite.prepare("UPDATE portfolios SET payload=json_set(json_set(payload,'$.trades',json(?)),'$.quotes',json(?))").run(JSON.stringify([trade]), JSON.stringify({ LUCK: quote }));
  const fresh = await startRun(env, OWNER, body());
  assert.notEqual(fresh.id, first.id, 'new holdings start a new run');
});

test('the run snapshot freezes holdings, index context and policy versions', async () => {
  const { env, db } = world();
  db.sqlite.prepare("INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at) VALUES ('latest',?,?,?)")
    .run(JSON.stringify({ index: { close: 168346.16, asOf: '2026-10-02 15:11:00' } }), 'x', 'x');
  const started = await startRun(env, OWNER, body());
  const row = await drive(env, started.id);
  const snapshot = JSON.parse(row.snapshot);
  assert.deepEqual(snapshot.inputs.index, { code: 'KSE100', close: 168346.16, asOf: '2026-10-02 15:11:00' });
  assert.equal(snapshot.inputs.policy.concentrationCapPct, 20);
  assert.deepEqual(snapshot.inputs.holdings, []);
  assert.ok(JSON.parse(row.result).versions.policy >= 3);
});
