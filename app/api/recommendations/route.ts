import { db, failure, identity } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { dispatchEnabled, requestFacts } from '@/lib/github-dispatch';
import { cleanWatchTickers } from '@/lib/market-watch';
import { buildPublicAnalysis } from '@/lib/public-analysis';
import { FACTS_DISPATCH_LIMIT } from '@/lib/monthly-picks-flow';
import { takeRateLimit, waitText } from '@/lib/rate-limit';
import { UserError } from '@/lib/user-error';

const publicJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });

/**
 * Public analysis only. The client names the tickers (a public fact it already sends for quotes) and ranks and
 * sizes them itself, so the server never receives or stores an amount, a shortlist, holdings or a result.
 * `?tickers=` returns PSX facts, quotes and quant scores; `refresh-facts` asks GitHub Actions to scrape
 * company pages and carries only the tickers.
 */
export async function GET(req: Request) {
  try {
    await identity(req);
    const tickers = cleanWatchTickers(new URL(req.url).searchParams.get('tickers'));
    if (!tickers.length) throw new UserError('Choose at least one company.');
    return publicJson({ ...(await buildPublicAnalysis(db(), tickers)), dispatchEnabled: dispatchEnabled(dispatchConfig()) });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    const body = (await req.json()) as { action?: unknown; tickers?: unknown };
    if (body.action !== 'refresh-facts') throw new UserError('Unknown request.', 400);
    const tickers = cleanWatchTickers(Array.isArray(body.tickers) ? body.tickers.join(',') : null).slice(0, 40);
    if (!tickers.length) throw new UserError('Choose companies to refresh.');
    const limit = await takeRateLimit(db(), owner, 'facts-dispatch', FACTS_DISPATCH_LIMIT);
    if (!limit.allowed)
      throw new UserError(`Company data refreshes are limited to ${FACTS_DISPATCH_LIMIT.max} a day. Try again in ${waitText(limit.retryAfterMs)}.`, 429);
    const result = await requestFacts(db(), dispatchConfig(), tickers);
    return publicJson({ dispatched: result.dispatched, waiting: result.waiting, reason: result.reason ?? null });
  } catch (error) { return failure(error); }
}
