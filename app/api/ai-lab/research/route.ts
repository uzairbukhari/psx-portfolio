import { env } from 'cloudflare:workers';
import { dispatchConfig } from '@/lib/dispatch-config';
import { cleanAiLabTickers, readPublicResearch, requestResearch } from '@/lib/ai-lab-server';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * AI Lab research for client-named tickers (super admin only). Public analysis only: the client names tickers, the
 * server returns stored reports, the ranking and this month's spend. No amount, holding or portfolio is involved.
 */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const tickers = cleanAiLabTickers(new URL(req.url).searchParams.get('tickers'));
    return json(await readPublicResearch(db(), tickers, env));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req, true);
    const body = (await req.json()) as { tickers?: unknown };
    const tickers = cleanAiLabTickers(body.tickers);
    if (!tickers.length) throw new UserError('Choose companies to research.');
    const outcome = await requestResearch(db(), dispatchConfig(), tickers, env);
    if (!outcome.queued.length && outcome.reason) throw new UserError(outcome.reason, 409);
    return json(outcome);
  } catch (error) { return failure(error); }
}
