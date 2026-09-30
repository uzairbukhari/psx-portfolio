import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';

export async function GET(req: Request) {
  try {
    await identity(req);
    const batch = new URL(req.url).searchParams.get('tickers');
    if (batch !== null) {
      const tickers = Array.from(
        new Set(batch.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)),
      );
      if (tickers.length > 60 || !tickers.every(tickerOK)) throw Error('Invalid symbols.');
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
        { histories: Object.fromEntries(rows.map((r) => [r.ticker, { eod: JSON.parse(r.eod) }])) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const ticker = (new URL(req.url).searchParams.get('ticker') ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker)) throw Error('Invalid symbol.');
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
    return Response.json(
      {
        ticker,
        eod: row ? JSON.parse(row.eod) : [],
        intraday: row ? JSON.parse(row.intraday) : [],
        eodFetchedAt: row?.eod_fetched_at ?? null,
        intradayFetchedAt: row?.intraday_fetched_at ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
