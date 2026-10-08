import type {
  PriceHistoryBatchResponse,
  PriceHistoryRequestResponse,
  PriceHistoryResponse,
} from '@/lib/api-types';
import { dispatchConfig } from '@/lib/dispatch-config';
import { readRequests, requestRefresh, tickerState } from '@/lib/workflow-requests';
import { dataMeta } from '@/lib/market-freshness';
import { pktDate, type PricePoint } from '@/lib/price-history';
import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';
import { UserError } from '@/lib/user-error';

export async function GET(req: Request) {
  try {
    await identity(req);
    const batch = new URL(req.url).searchParams.get('tickers');
    if (batch !== null) {
      const tickers = Array.from(
        new Set(batch.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)),
      );
      if (tickers.length > 60 || !tickers.every(tickerOK)) throw new UserError('Invalid symbols.');
      const rows = tickers.length
        ? (
            await db()
              .prepare(
                `SELECT ticker, eod FROM price_history WHERE ticker IN (${tickers.map(() => '?').join(',')})`,
              )
              .bind(...tickers)
              .all<{ ticker: string; eod: string }>()
          ).results
        : [];
      return Response.json(
        {
          histories: Object.fromEntries(rows.map((r) => [r.ticker, { eod: JSON.parse(r.eod) }])),
        } satisfies PriceHistoryBatchResponse,
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const ticker = (new URL(req.url).searchParams.get('ticker') ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker)) throw new UserError('Invalid symbol.');
    const row = await db()
      .prepare(
        'SELECT eod, intraday, eod_fetched_at, intraday_fetched_at FROM price_history WHERE ticker=?',
      )
      .bind(ticker)
      .first<{
        eod: string;
        intraday: string;
        eod_fetched_at: string | null;
        intraday_fetched_at: string | null;
      }>();
    const eod: PricePoint[] = row ? JSON.parse(row.eod) : [];
    const intraday: PricePoint[] = row ? JSON.parse(row.intraday) : [];
    // Judge a series by its newest point (the session it really covers), not by when it was fetched.
    const metaFor = (points: PricePoint[], fetchedAt: string | null, precise: boolean) => {
      const last = points.reduce((max, point) => Math.max(max, point[0]), 0);
      return dataMeta({
        provider: 'PSX Data Portal',
        sourceUrl: `https://dps.psx.com.pk/company/${ticker}`,
        sourceTimestamp: precise && last ? new Date(last * 1000).toISOString() : null,
        sessionDate: last ? pktDate(last) : null,
        fetchedAt,
      });
    };
    return Response.json(
      {
        ticker,
        eod,
        intraday,
        eodFetchedAt: row?.eod_fetched_at ?? null,
        intradayFetchedAt: row?.intraday_fetched_at ?? null,
        eodMeta: metaFor(eod, row?.eod_fetched_at ?? null, false),
        intradayMeta: metaFor(intraday, row?.intraday_fetched_at ?? null, true),
        request: tickerState((await readRequests(db(), 'history', [ticker])).get(ticker), ticker, Date.now()),
      } satisfies PriceHistoryResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * Asks for one symbol's price history to be fetched now (GitHub Actions; PSX blocks Cloudflare). Only a symbol the
 * company directory lists is accepted, so half-typed searches never start a fetch. The body is just the symbol.
 */
export async function POST(req: Request) {
  try {
    await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { ticker?: unknown };
    const ticker = (typeof body.ticker === 'string' ? body.ticker : '').trim().toUpperCase();
    if (!tickerOK(ticker)) throw new UserError('Invalid symbol.');
    const listed = await db()
      .prepare("SELECT 1 AS ok FROM security_catalog WHERE ticker=? AND COALESCE(listing_status,'')<>'delisted'")
      .bind(ticker)
      .first();
    if (!listed) throw new UserError(`${ticker} is not a listed PSX symbol.`);
    const result = await requestRefresh(db(), dispatchConfig(), 'history', [ticker]);
    const request = tickerState((await readRequests(db(), 'history', [ticker])).get(ticker), ticker, Date.now());
    const started = result.dispatched || result.alreadyRunning.includes(ticker);
    return Response.json(
      { request, started, ...(started ? {} : { reason: result.reason }) } satisfies PriceHistoryRequestResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
