import initialQuotes from '@/lib/initial-quotes.json';
import { db, identity, failure } from '@/lib/server';
import { initialPortfolio, validate } from '@/lib/portfolio';
export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const row = await db()
      .prepare('SELECT payload,revision FROM portfolios WHERE user_id=?')
      .bind(user)
      .first<{ payload: string; revision: number }>();
    return Response.json(
      {
        portfolio: row
          ? JSON.parse(row.payload)
          : { ...initialPortfolio(), quotes: initialQuotes },
        revision: row?.revision ?? 0,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    const user = await identity(req, true);
    const text = await req.text();
    if (text.length > 4000000) throw Error('Portfolio file is too large.');
    const { portfolio, revision } = JSON.parse(text);
    validate(portfolio);
    if (!Number.isInteger(revision) || revision < 0)
      throw Error('Invalid revision.');
    const body = JSON.stringify(portfolio),
      now = new Date().toISOString();
    const result =
      revision === 0
        ? await db()
            .prepare(
              'INSERT INTO portfolios (user_id,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO NOTHING',
            )
            .bind(user, body, now)
            .run()
        : await db()
            .prepare(
              'UPDATE portfolios SET payload=?, revision=revision+1,updated_at=? WHERE user_id=? AND revision=?',
            )
            .bind(body, now, user, revision)
            .run();
    if (!result.meta.changes)
      return failure(
        Error('Your portfolio changed in another tab. Reload before saving.'),
        409,
      );
    return Response.json(
      { revision: revision + 1 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
