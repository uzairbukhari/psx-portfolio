import { db } from '@/lib/server';
import { today } from '@/lib/portfolio';
import { helperFailure, helperIdentity } from '@/lib/research-jobs';

type QuoteRefreshRow = {
  id: string;
  user_id: string;
  tickers: string;
  status: 'queued' | 'fetching' | 'complete' | 'needs_attention';
  lease_owner: string | null;
};

type SubmittedQuote = {
  price: number;
  asOf: string;
  date: string;
  source: string;
  fetchedAt: string;
};

function validQuote(value: unknown, ticker: string): value is SubmittedQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Record<string, unknown>;
  return (
    typeof quote.price === 'number' &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    typeof quote.asOf === 'string' &&
    typeof quote.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(quote.date) &&
    quote.date <= today() &&
    quote.source === `https://dps.psx.com.pk/company/${ticker}` &&
    typeof quote.fetchedAt === 'string'
  );
}

export async function POST(req: Request) {
  try {
    const helper = await helperIdentity(req);
    const body = (await req.json()) as {
      id?: string;
      quotes?: Record<string, unknown>;
      errors?: unknown;
      reasons?: Record<string, unknown>;
      error?: unknown;
    };
    const row = await db()
      .prepare('SELECT * FROM quote_refreshes WHERE id=? AND user_id=?')
      .bind(body.id, helper.user_id)
      .first<QuoteRefreshRow>();
    if (!row) throw Error('Quote refresh was not found.');
    if (row.status === 'complete') return Response.json({ complete: true });
    if (row.status !== 'fetching' || row.lease_owner !== helper.id)
      throw Error('This quote refresh is leased to another helper process.');
    const tickers = JSON.parse(row.tickers) as string[];
    const submitted = body.quotes && typeof body.quotes === 'object' ? body.quotes : {};
    const quotes: Record<string, SubmittedQuote> = {};
    for (const ticker of tickers)
      if (validQuote(submitted[ticker], ticker)) quotes[ticker] = submitted[ticker];
    const errors = Array.isArray(body.errors)
      ? [...new Set(body.errors.map(String).filter((ticker) => tickers.includes(ticker)))]
      : [];
    const reasons: Record<string, string> = {};
    for (const ticker of errors) {
      const reason = body.reasons?.[ticker];
      if (typeof reason === 'string') reasons[ticker] = reason.slice(0, 1000);
    }
    const now = new Date().toISOString();
    const result = JSON.stringify({ quotes, errors, reasons });
    const status = Object.keys(quotes).length || errors.length ? 'complete' : 'needs_attention';
    const error =
      status === 'needs_attention'
        ? String(body.error || 'The Mac helper could not fetch PSX quotes.').slice(0, 1000)
        : null;
    await db()
      .prepare(
        'UPDATE quote_refreshes SET status=?,result=?,error=?,lease_owner=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=? AND lease_owner=?',
      )
      .bind(status, result, error, now, now, row.id, helper.id)
      .run();
    return Response.json({ complete: status === 'complete' });
  } catch (error) {
    return helperFailure(error);
  }
}
