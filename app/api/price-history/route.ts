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
import { serverTiming } from '@/lib/server-timing';
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
      const startedAt = Date.now();
      const from = new URL(req.url).searchParams.get('from');
      if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new UserError('Invalid date.');
      const cache = { 'Cache-Control': 'private, max-age=900, must-revalidate' };
      if (!tickers.length) return Response.json({ histories: {} } satisfies PriceHistoryBatchResponse, { headers: cache });
      const marks = tickers.map(() => '?').join(',');
      // A light check first: when the stored closes have not changed since the browser's copy, answer 304 and never
      // read or send the big series.
      const version = await db()
        .prepare(`SELECT COUNT(*) AS n, MAX(eod_fetched_at) AS t FROM price_history WHERE ticker IN (${marks})`)
        .bind(...tickers)
        .first<{ n: number; t: string | null }>();
      const etag = `W/"ph|${tickers.join('.')}|${from ?? ''}|${version?.n ?? 0}|${version?.t ?? ''}"`;
      if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...cache, ETag: etag } });
      const rows = (
        await db()
          .prepare(`SELECT ticker, eod FROM price_history WHERE ticker IN (${marks})`)
          .bind(...tickers)
          .all<{ ticker: string; eod: string }>()
      ).results;
      // The stored text is already JSON: pass it through instead of parsing and re-encoding every series.
      // Only a `from` date needs it parsed, to cut the older closes.
      const fromSecs = from ? Date.parse(`${from}T00:00:00Z`) / 1000 : 0;
      const body = `{"histories":{${rows
        .map(
          (r) =>
            `${JSON.stringify(r.ticker)}:{"eod":${
              fromSecs ? JSON.stringify((JSON.parse(r.eod) as PricePoint[]).filter((point) => point[0] >= fromSecs)) : r.eod
            }}`,
        )
        .join(',')}}}`;
      return new Response(body, { headers: { ...cache, ...serverTiming(startedAt, rows.length), ETag: etag, 'Content-Type': 'application/json' } });
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
    return failure(error, undefined, req);
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
    return failure(error, undefined, req);
  }
}
