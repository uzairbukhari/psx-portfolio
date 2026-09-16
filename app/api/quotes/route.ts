import { failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';
import { fetchPsxQuote } from '@/lib/psx-quotes';
import type { Quote } from '@/lib/portfolio';

const CONCURRENCY = 5;

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
      throw Error('Invalid symbols.');
    const quotes: Record<string, Quote> = {};
    const errors: string[] = [];
    const reasons: Record<string, string> = {};
    for (let index = 0; index < tickers.length; index += CONCURRENCY) {
      await Promise.all(
        tickers.slice(index, index + CONCURRENCY).map(async (ticker) => {
          try {
            quotes[ticker] = await fetchPsxQuote(ticker);
          } catch (error) {
            errors.push(ticker);
            reasons[ticker] =
              (error instanceof Error ? error.message : 'Unknown failure').slice(
                0,
                1000,
              );
          }
        }),
      );
    }
    if (!Object.keys(quotes).length && errors.length)
      throw Error('Every PSX quote request failed.');
    return Response.json(
      { quotes, errors, reasons },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
