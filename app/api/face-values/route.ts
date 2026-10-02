import { db, identity, failure } from '@/lib/server';
import { blankPortfolio, type Portfolio } from '@/lib/portfolio';
import { dispatchConfig } from '@/lib/dispatch-config';
import { faceValueStatus, requestFaceValues } from '@/lib/face-value-api';
import { UserError } from '@/lib/user-error';

const headers = { 'Cache-Control': 'no-store' };

async function load(user: string) {
  const row = await db().prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(user).first<{ payload: string }>();
  return (row ? JSON.parse(row.payload) : blankPortfolio()) as Portfolio;
}

/** Verified face-value evidence and fetch status for the signed-in ledger's companies. */
export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const asked = new URL(req.url).searchParams.get('tickers');
    return Response.json(await faceValueStatus(db(), await load(user), dispatchConfig(), asked ? asked.split(',') : undefined), { headers });
  } catch (e) {
    return failure(e);
  }
}

/** Queues a background lookup for the ledger's companies that have no verified face value. */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    let body: { tickers?: unknown } = {};
    try {
      body = (await req.json()) as { tickers?: unknown };
    } catch {
      body = {};
    }
    if (body && typeof body !== 'object') throw new UserError('Invalid request.');
    return Response.json(await requestFaceValues(db(), user, await load(user), dispatchConfig(), body.tickers), { headers });
  } catch (e) {
    return failure(e);
  }
}
