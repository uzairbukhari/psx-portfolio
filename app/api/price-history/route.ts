import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';

export async function GET(req: Request) {
  try {
    await identity(req);
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
