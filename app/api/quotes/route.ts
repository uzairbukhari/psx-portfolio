import { db, failure, identity } from '@/lib/server';
import { tickerOK } from '@/lib/research-jobs';

type QuoteRefreshRow = {
  id: string;
  user_id: string;
  tickers: string;
  status: 'queued' | 'fetching' | 'complete' | 'needs_attention';
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function publicRefresh(row: QuoteRefreshRow) {
  let result: Record<string, unknown> = {};
  try {
    result = row.result ? JSON.parse(row.result) : {};
  } catch {}
  return {
    id: row.id,
    status: row.status,
    quotes: result.quotes ?? {},
    errors: result.errors ?? [],
    reasons: result.reasons ?? {},
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function GET(req: Request) {
  try {
    const userId = await identity(req);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw Error('Quote refresh id is required.');
    const row = await db()
      .prepare('SELECT * FROM quote_refreshes WHERE id=? AND user_id=?')
      .bind(id, userId)
      .first<QuoteRefreshRow>();
    if (!row) return failure(Error('Quote refresh was not found.'), 404);
    return Response.json(publicRefresh(row), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await identity(req, true);
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
    const active = await db()
      .prepare(
        "SELECT * FROM quote_refreshes WHERE user_id=? AND status IN ('queued','fetching') ORDER BY created_at DESC LIMIT 1",
      )
      .bind(userId)
      .first<QuoteRefreshRow>();
    if (active)
      return Response.json(
        { refresh: publicRefresh(active), existing: true },
        { status: 202, headers: { 'Cache-Control': 'no-store' } },
      );
    const now = new Date().toISOString();
    const row: QuoteRefreshRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      tickers: JSON.stringify(tickers),
      status: 'queued',
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    await db()
      .prepare(
        'INSERT INTO quote_refreshes (id,user_id,tickers,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .bind(row.id, row.user_id, row.tickers, row.status, now, now)
      .run();
    return Response.json(
      { refresh: publicRefresh(row), existing: false },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
