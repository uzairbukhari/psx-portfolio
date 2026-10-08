import { db, identity, failure } from '@/lib/server';

const headers = { 'Cache-Control': 'private, max-age=60' };
const like = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Search the shared PSX company catalog by symbol or name: ?q=meez. Public data only, so the query never says what
 * anyone holds. Symbol matches rank first, then names.
 */
export async function GET(req: Request) {
  try {
    await identity(req);
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 40);
    if (q.length < 1) return Response.json({ companies: [] }, { headers });
    const rows = await db()
      .prepare(
        `SELECT ticker,name,sector_name AS sector FROM security_catalog
         WHERE ticker LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
         ORDER BY CASE WHEN UPPER(ticker)=UPPER(?) THEN 0 WHEN ticker LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, ticker
         LIMIT 8`,
      )
      .bind(like(q), like(q), q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      .all<{ ticker: string; name: string; sector: string | null }>();
    return Response.json({ companies: rows.results }, { headers });
  } catch (e) {
    return failure(e);
  }
}
