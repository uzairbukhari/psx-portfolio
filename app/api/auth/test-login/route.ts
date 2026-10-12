import { env } from 'cloudflare:workers';
import { handleTestLogin } from '@/lib/test-login';
import { db, failure } from '@/lib/server';

async function handle(req: Request) {
  try {
    return await handleTestLogin(req, env, db());
  } catch (e) {
    // TEMPORARY diagnostic (staging only): remove once the staging sign-in 500 is understood.
    if (env.APP_ENV === 'staging')
      return Response.json({ error: 'diag', detail: `${(e as Error)?.name}: ${(e as Error)?.message}`.slice(0, 300) }, { status: 500 });
    return failure(e);
  }
}
export const GET = handle;
export const POST = handle;
