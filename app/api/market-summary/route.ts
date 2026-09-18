import { db, identity, failure } from '@/lib/server';
import {
  fetchPsxIndexSummary,
  fetchPsxTopMovers,
  fetchPsxIndexSeries,
  type IndexSummary,
  type TopMovers,
  type IndexPoint,
} from '@/lib/psx-market';

export interface MarketSummaryPayload {
  index: IndexSummary;
  movers: TopMovers;
  series: IndexPoint[];
  sectors: { sector: string; changePercent: number; companyCount: number }[];
}

export async function GET(req: Request) {
  try {
    await identity(req);
    const row = await db()
      .prepare('SELECT payload, fetched_at FROM market_summary_refreshes WHERE id=?')
      .bind('latest')
      .first<{ payload: string; fetched_at: string }>();
    if (!row) return Response.json({ summary: null }, { headers: { 'Cache-Control': 'no-store' } });
    return Response.json(
      { summary: JSON.parse(row.payload) as MarketSummaryPayload, fetchedAt: row.fetched_at },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    await identity(req, true);
    const [index, movers, series] = await Promise.all([
      fetchPsxIndexSummary('KSE100'),
      fetchPsxTopMovers(),
      fetchPsxIndexSeries('KSE100'),
    ]);
    const cached = await db()
      .prepare('SELECT payload FROM market_summary_refreshes WHERE id=?')
      .bind('latest')
      .first<{ payload: string }>();
    const sectors = cached ? (JSON.parse(cached.payload) as MarketSummaryPayload).sectors : [];
    const payload: MarketSummaryPayload = { index, movers, series, sectors };
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at)
         VALUES ('latest',?,?,?)
         ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
      )
      .bind(JSON.stringify(payload), index.fetchedAt, now)
      .run();
    return Response.json({ summary: payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
