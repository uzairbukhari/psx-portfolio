import { env } from 'cloudflare:workers';
import { db, failure, identity } from '@/lib/server';
import { readFactsStatus } from '@/lib/company-facts-store';
import { dispatchConfig } from '@/lib/dispatch-config';
import { dispatchEnabled } from '@/lib/github-dispatch';
import { FACTS_MAX_AGE_DAYS } from '@/lib/monthly-picks-flow';
import { advanceRun, listRuns, readPortfolio, readRow, refreshFacts, startRun, viewOne, type RunEnv, type StartInput } from '@/lib/recommendation-service';
import { UserError } from '@/lib/user-error';

const privateJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const runEnv = (): RunEnv => ({ db: db(), openaiKey: env.OPENAI_API_KEY, aiCapUsd: env.AI_MONTHLY_CAP_USD, dispatch: dispatchConfig() });
/**
 * With PICKS_BACKGROUND=true the quote-refresh Worker's per-minute cron owns run execution and
 * GET is read-only. Without it (cron not deployed yet) GET still nudges a run forward, under the
 * same lease, so nothing stalls during the rollout.
 */
const backgroundOwnsRuns = () => String(env.PICKS_BACKGROUND ?? '') === 'true';

export async function GET(req: Request) {
  try {
    const owner = await identity(req);
    const context = runEnv();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      const portfolio = await readPortfolio(context, owner);
      const statuses = await readFactsStatus(context.db, portfolio.companies.map((company) => company.ticker)).catch(() => []);
      return privateJson({
        recommendations: await listRuns(context, owner),
        facts: statuses.map(({ ticker, state, fetchedOn, ageDays, error }) => ({ ticker, state, fetchedOn, ageDays, error })),
        dispatchEnabled: dispatchEnabled(context.dispatch),
        factsMaxAgeDays: FACTS_MAX_AGE_DAYS,
        backgroundProcessing: backgroundOwnsRuns(),
      });
    }
    let row = await readRow(context, id, owner);
    if (!row) return failure(new UserError('Recommendation not found.'), 404);
    if (!backgroundOwnsRuns()) row = (await advanceRun(context, row.id)) ?? row;
    return privateJson(await viewOne(context, row));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    const body = await req.json() as Record<string, unknown>;
    const context = runEnv();
    if (body.action === 'refresh-facts') return privateJson(await refreshFacts(context, owner, body.tickers));
    return privateJson(await startRun(context, owner, body as StartInput));
  } catch (error) { return failure(error); }
}
