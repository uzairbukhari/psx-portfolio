import type { QuotesResponse } from '@/lib/api-types';
import { dispatchConfig } from '@/lib/dispatch-config';
import { dataMeta } from '@/lib/market-freshness';
import { quoteObservedAt } from '@/lib/quote-write';
import { quoteJobStatus, requestQuoteJob, type QuoteSnapshot } from '@/lib/quote-jobs';
import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';
import { takeRateLimit, waitText } from '@/lib/rate-limit';
import { UserError } from '@/lib/user-error';

const FORCE_COOLDOWN = { windowMs: 5 * 60_000, max: 1 };

function cleanTickers(value: unknown): string[] {
  const tickers = Array.isArray(value)
    ? [...new Set(value.map((ticker) => String(ticker).trim().toUpperCase()))]
    : [];
  if (!tickers.length || tickers.length > 200 || tickers.some((ticker) => !tickerOK(ticker)))
    throw new UserError('Invalid symbols.');
  return tickers;
}

/** Shapes the cache snapshot and job into the response; every note and message is already user-safe. */
function respond(snapshot: QuoteSnapshot, job: QuotesResponse['job']) {
  const at = new Date().toISOString();
  const meta = Object.fromEntries(
    Object.entries(snapshot.quotes).map(([ticker, quote]) => [
      ticker,
      dataMeta({
        provider: 'PSX Data Portal',
        sourceUrl: quote.source,
        sourceTimestamp: quoteObservedAt(quote.asOf),
        sessionDate: quote.date,
        fetchedAt: quote.fetchedAt,
        // A pending or failed refresh sits next to the old value; it never makes the value look newer.
        lastFailure: snapshot.stale[ticker] ? { at, message: snapshot.stale[ticker] } : null,
      }),
    ]),
  );
  return Response.json(
    {
      quotes: snapshot.quotes,
      errors: Object.keys(snapshot.failed),
      reasons: snapshot.failed,
      stale: snapshot.stale,
      meta,
      job,
    } satisfies QuotesResponse,
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Manual refresh. Serves the cached prices at once and queues the stale ones for the scheduled scraper
 * (PSX refuses Cloudflare, so the Worker never fetches). `job` says what is happening; poll GET for it.
 */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const tickers = cleanTickers(((await req.json()) as { tickers?: unknown }).tickers);
    const force = new URL(req.url).searchParams.get('force') === '1';
    if (force) {
      // A forced refresh bypasses the shared cache, so it is limited to the
      // caller's own companies and to one call per cooldown window.
      const row = await db()
        .prepare('SELECT payload FROM portfolios WHERE user_id=?')
        .bind(user)
        .first<{ payload: string }>();
      const held = new Set(
        (JSON.parse(row?.payload ?? '{}') as { companies?: { ticker: string }[] })
          .companies?.map((company) => company.ticker) ?? [],
      );
      if (tickers.some((ticker) => !held.has(ticker)))
        throw new UserError('A forced refresh only covers companies in your portfolio.');
      const limit = await takeRateLimit(db(), user, 'quote-force', FORCE_COOLDOWN);
      if (!limit.allowed)
        throw new UserError(
          `Forced price refresh is limited to once every 5 minutes. Try again in ${waitText(limit.retryAfterMs)}.`,
          429,
        );
    }
    const { snapshot, job } = await requestQuoteJob(db(), dispatchConfig(), tickers, { force });
    return respond(snapshot, job);
  } catch (error) {
    return failure(error);
  }
}

/** Polling: `?tickers=A,B&since=<job.requestedAt>`. Read-only; never starts or cancels a refresh. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const url = new URL(req.url);
    const tickers = cleanTickers((url.searchParams.get('tickers') ?? '').split(','));
    const since = url.searchParams.get('since') ?? undefined;
    if (since && Number.isNaN(Date.parse(since))) throw new UserError('Invalid time.');
    const { snapshot, job } = await quoteJobStatus(db(), tickers, since);
    return respond(snapshot, job);
  } catch (error) {
    return failure(error);
  }
}
