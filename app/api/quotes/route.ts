import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';
import { refreshQuotes } from '@/lib/quote-cache';
import { UserError } from '@/lib/user-error';

export async function POST(req: Request) {
  try {
    await identity(req, true);
    const input = (await req.json()) as { tickers?: unknown };
    const tickers = Array.isArray(input.tickers)
      ? [
          ...new Set(
            input.tickers.map((ticker) => String(ticker).trim().toUpperCase()),
          ),
        ]
      : [];
    if (
      !tickers.length ||
      tickers.length > 200 ||
      tickers.some((ticker) => !tickerOK(ticker))
    )
      throw new UserError('Invalid symbols.');
    const force = new URL(req.url).searchParams.get('force') === '1';
    const { quotes, stale, failed } = await refreshQuotes(db(), tickers, { force });
    const errors = Object.keys(failed);
    if (!Object.keys(quotes).length && errors.length)
      throw new UserError('Every PSX quote request failed.');
    return Response.json(
      { quotes, errors, reasons: failed, stale },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
