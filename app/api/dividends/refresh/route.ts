import type { DividendRefreshResponse } from '@/lib/api-types';
import { db, identity, failure } from '@/lib/server';
import { blankPortfolio, type Portfolio } from '@/lib/portfolio';
import { dispatchConfig } from '@/lib/dispatch-config';
import { dividendRefreshStatus, requestDividendRefresh } from '@/lib/refresh-api';

async function load(user: string) {
  const row = await db()
    .prepare('SELECT payload,revision FROM portfolios WHERE user_id=?')
    .bind(user)
    .first<{ payload: string; revision: number }>();
  return { portfolio: (row ? JSON.parse(row.payload) : blankPortfolio()) as Portfolio, revision: row?.revision ?? 0 };
}

const json = (body: DividendRefreshResponse) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });

/** Status of the historical announcement fetch for the signed-in ledger's companies, plus the cached announcements. */
export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const { portfolio, revision } = await load(user);
    return json(await dividendRefreshStatus(db(), portfolio, revision, dispatchConfig()));
  } catch (e) {
    return failure(e);
  }
}

/** Starts a fetch for the ledger's own historical tickers (a body `tickers` list can only narrow it). */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { tickers?: unknown };
    const { portfolio, revision } = await load(user);
    return json(await requestDividendRefresh(db(), user, portfolio, revision, dispatchConfig(), body.tickers));
  } catch (e) {
    return failure(e);
  }
}
