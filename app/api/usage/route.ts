import { db, identity, failure } from '@/lib/server';

export async function GET(req: Request) {
  try {
    const owner = await identity(req);
    const row = await db()
      .prepare(
        'SELECT COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(cost_usd),0) AS costUsd FROM ai_usage WHERE user_id=?',
      )
      .bind(owner)
      .first<{ inputTokens: number; outputTokens: number; costUsd: number }>();
    return Response.json(
      row ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
