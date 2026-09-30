import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';
import { refreshQuotes } from '@/lib/quote-cache';
import { takeRateLimit, waitText } from '@/lib/rate-limit';
import { UserError } from '@/lib/user-error';

const FORCE_COOLDOWN = { windowMs: 5 * 60_000, max: 1 };

export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
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
          `Forced PSX refresh is limited to once every 5 minutes. Try again in ${waitText(limit.retryAfterMs)}.`,
          429,
        );
    }
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
