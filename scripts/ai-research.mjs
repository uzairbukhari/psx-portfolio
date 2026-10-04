// Monthly AI research job for the experimental AI Lab (super admin). Runs on a GitHub Actions runner and writes the
// shared, public `ai_*` tables. It sees only public tickers and PSX data: no portfolio, holding, amount or account.
//
// Tickers: --tickers=A,B, else every ticker with a queued/researching request, else with --monthly every ticker
// requested in the last 45 days. Optional cap: AI_RESEARCH_MONTHLY_CAP_USD (default none). Provider: AI_RESEARCH_PROVIDER
// (openai by default, anthropic to switch). Kill switch: AI_LAB_ENABLED=false.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, OPENAI_API_KEY (or ANTHROPIC_API_KEY), optional D1_DATABASE_ID.
// Usage: node scripts/ai-research.mjs [--dry-run] [--list] [--monthly] [--force] [--tickers=MEBL,LUCK]
import { randomUUID } from 'node:crypto';
import { d1 } from './d1-rest.mjs';
import { resolveConfig } from '../lib/ai-research/models.ts';
import { createProvider } from '../lib/ai-research/provider.ts';
import { runResearch } from '../lib/ai-research/pipeline.ts';
import { createStore } from '../lib/ai-research/store.ts';
import { fetchPageText } from '../lib/ai-research/fetch-text.ts';

const dryRun = process.argv.includes('--dry-run');
const monthly = process.argv.includes('--monthly');
const force = process.argv.includes('--force');
const listOnly = process.argv.includes('--list');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));
const TICKER = /^[A-Z0-9]{2,12}$/;
const log = (message) => (listOnly ? console.error : console.log)(`[ai-research] ${message}`);

async function main() {
  const config = resolveConfig(process.env);
  if (!config.enabled) { log('AI_LAB_ENABLED=false: nothing to do.'); return 0; }
  const store = createStore(d1);
  const now = new Date();
  let tickers;
  if (tickerArg) tickers = tickerArg.slice('--tickers='.length).split(',').map((t) => t.trim().toUpperCase());
  else {
    tickers = await store.pendingRequests();
    if (monthly) tickers = [...new Set([...tickers, ...(await store.recentRequests(new Date(now.getTime() - 45 * 86_400_000).toISOString()))])];
  }
  tickers = [...new Set(tickers.filter((t) => TICKER.test(t)))].slice(0, 40);
  // --list prints the comma-separated tickers on stdout only, so a workflow can scrape their PSX data first.
  if (listOnly) { console.log(tickers.join(',')); return 0; }
  if (!tickers.length) { log('No requested tickers.'); return 0; }
  log(`provider ${config.provider}; read ${config.models.read}, rank ${config.models.rank}; ${config.monthlyCapUsd === null ? 'no cap' : `cap $${config.monthlyCapUsd}`}; ${tickers.length} tickers: ${tickers.join(', ')}`);
  if (dryRun) {
    const spent = await store.spentSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
    log(`dry run: spent $${spent.toFixed(2)} this month; no model calls made.`);
    return 0;
  }
  const provider = await createProvider(config, { openaiKey: process.env.OPENAI_API_KEY, anthropicKey: process.env.ANTHROPIC_API_KEY });
  const runId = randomUUID();
  await store.startRun(runId, now.toISOString(), config.provider, `${config.models.read},${config.models.rank}`);
  for (const ticker of tickers) await store.setRequestStatus(ticker, 'researching', now.toISOString());
  let result;
  try {
    result = await runResearch({ store, provider, config, tickers, runId, force, io: { fetchText: fetchPageText, now: () => new Date(), log } });
  } catch (error) {
    await store.finishRun(runId, 'failed', 0, {}, error instanceof Error ? error.message : String(error), new Date().toISOString());
    for (const ticker of tickers) await store.setRequestStatus(ticker, 'failed', new Date().toISOString(), 'The research job failed.');
    throw error;
  }
  const done = new Date().toISOString();
  for (const outcome of result.outcomes) {
    const ok = ['full', 'update', 'carry', 'fresh'].includes(outcome.decision);
    await store.setRequestStatus(outcome.ticker, ok ? 'ready' : 'failed', done, ok ? null : (outcome.note ?? 'Research did not complete.').slice(0, 300));
  }
  for (const ticker of tickers) if (!result.outcomes.some((o) => o.ticker === ticker)) await store.setRequestStatus(ticker, 'failed', done, 'Not processed.');
  await store.finishRun(runId, result.status, result.costUsd, { outcomes: result.outcomes, ranked: result.ranked, calls: result.calls }, result.error, done);
  log(`${result.status}: cost $${result.costUsd.toFixed(3)}, ${result.calls} calls, ${result.ranked} ranked. ${result.outcomes.map((o) => `${o.ticker}=${o.decision}`).join(' ')}`);
  return result.status === 'failed' ? 1 : 0;
}

main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
