import { env } from 'cloudflare:workers';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { picksHealth } from '@/lib/recommendation-service';

/** Operational health for administrators: run processor, data freshness, recent scrape failures. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const health = await picksHealth({ db: db(), openaiKey: env.OPENAI_API_KEY, aiCapUsd: env.AI_MONTHLY_CAP_USD, dispatch: dispatchConfig() });
    return Response.json({ ...health, backgroundProcessing: String(env.PICKS_BACKGROUND ?? '') === 'true' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
