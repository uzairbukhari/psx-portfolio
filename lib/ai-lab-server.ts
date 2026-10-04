// Worker-side reads and the research request for the AI Lab tab (super admin only; the routes guard access).
// Everything here is public analysis keyed by ticker: no portfolio, holding or amount is read or written.
import { resolveConfig } from './ai-research/models.ts';
import { monthKey } from './ai-research/ledger.ts';
import { createStore, type Query } from './ai-research/store.ts';
import type { PublicResearch, Ranking } from './ai-research/types.ts';
import type { DispatchConfig } from './github-dispatch.ts';

type Env = { AI_LAB_ENABLED?: string; AI_RESEARCH_MONTHLY_CAP_USD?: string };
const TICKER = /^[A-Z0-9]{2,12}$/;
/** A "researching" request older than this is treated as dead so it can be requested again. */
const STALE_RESEARCHING_MS = 90 * 60_000;

export const d1Query = (db: D1Database): Query => async (sql, params = []) =>
  (await db.prepare(sql).bind(...params).all<Record<string, unknown>>()).results;

/** The stored ranking that covers the most of `tickers` (newest wins a tie). */
export function chooseRanking(rankings: { ranking: Ranking; createdAt: string }[], tickers: string[]): Ranking | null {
  const wanted = new Set(tickers);
  let best: { ranking: Ranking; score: number } | null = null;
  for (const { ranking } of rankings) {
    const score = ranking.entries.filter((e) => wanted.has(e.ticker)).length;
    if (score > 0 && (!best || score > best.score)) best = { ranking, score };
  }
  return best?.ranking ?? null;
}

export async function readPublicResearch(db: D1Database, tickers: string[], env: Env, now = new Date()): Promise<PublicResearch> {
  const config = resolveConfig(env);
  const store = createStore(d1Query(db));
  const month = monthKey(now);
  const spent = await store.spentSince(`${month}-01T00:00:00.000Z`);
  if (!config.enabled || !tickers.length)
    return { reports: [], ranking: null, macro: null, requests: [], spend: { month, usd: spent, capUsd: config.monthlyCapUsd }, enabled: config.enabled };
  const [reports, rankings, macro, requests] = await Promise.all([
    store.reportsFor(tickers), store.recentRankings(), store.latestMacro(), store.requestsFor(tickers),
  ]);
  return {
    reports, ranking: chooseRanking(rankings, tickers), macro,
    requests: requests.map(({ ticker, status, error, requestedAt }) => ({ ticker, status, error, requestedAt })),
    spend: { month, usd: Math.round(spent * 1000) / 1000, capUsd: config.monthlyCapUsd }, enabled: true,
  };
}

export type RequestOutcome = { queued: string[]; dispatched: boolean; reason: string | null };

/** The workflow that writes to this Worker's own database: production dispatches the prod one, staging its copy. */
export const workflowFor = (appEnv?: string) => (appEnv === 'staging' ? 'ai-research-staging.yml' : 'ai-research.yml');

export async function requestResearch(db: D1Database, config: DispatchConfig, tickers: string[], env: Env, now = new Date()): Promise<RequestOutcome> {
  if (!resolveConfig(env).enabled) return { queued: [], dispatched: false, reason: 'AI Lab research is switched off.' };
  const clean = [...new Set(tickers)].filter((t) => TICKER.test(t)).slice(0, 40);
  if (!clean.length) return { queued: [], dispatched: false, reason: 'Choose at least one company.' };
  const store = createStore(d1Query(db));
  const current = await store.requestsFor(clean);
  const running = new Set(current.filter((r) => r.status === 'researching' && r.startedAt && now.getTime() - Date.parse(r.startedAt) < STALE_RESEARCHING_MS).map((r) => r.ticker));
  const toQueue = clean.filter((t) => !running.has(t));
  if (!toQueue.length) return { queued: [], dispatched: false, reason: 'Research for these companies is already running.' };
  await store.queueRequests(toQueue, now.toISOString());
  if (!config.token || !config.repo) return { queued: toQueue, dispatched: false, reason: 'Queued. Automatic start is not configured here, so run the AI Lab research workflow in GitHub to process it.' };
  try {
    const response = await fetch(`https://api.github.com/repos/${config.repo}/actions/workflows/${workflowFor(config.appEnv)}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'psx-portfolio-worker', 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { tickers: toQueue.join(',') } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { queued: toQueue, dispatched: false, reason: `Queued, but GitHub answered ${response.status} when starting the job.` };
    return { queued: toQueue, dispatched: true, reason: null };
  } catch (error) {
    return { queued: toQueue, dispatched: false, reason: `Queued, but the job could not be started (${error instanceof Error ? error.message : 'network error'}).` };
  }
}
