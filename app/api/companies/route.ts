import { db, identity, failure } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { companyStatus, requestCompanyLookup } from '@/lib/company-api';
import { readLimited } from '@/lib/read-limited';
import { UserError } from '@/lib/user-error';

const headers = { 'Cache-Control': 'no-store' };

/** Cached company details from the shared directory: ?tickers=MEBL,LUCK. Read-only: never starts a lookup. */
export async function GET(req: Request) {
  try {
    await identity(req);
    return Response.json(await companyStatus(db(), new URL(req.url).searchParams.get('tickers'), dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}

/** Queues a background lookup for symbols the directory does not know yet: body { tickers: [...] }. */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const text = new TextDecoder().decode(await readLimited(req, 10_000, 'Request is too large.')) || '{}';
    let body: { tickers?: unknown };
    try {
      body = JSON.parse(text) as { tickers?: unknown };
    } catch {
      throw new UserError('Invalid request.');
    }
    return Response.json(await requestCompanyLookup(db(), user, body.tickers, dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}
