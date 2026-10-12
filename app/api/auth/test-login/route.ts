import { env } from 'cloudflare:workers';
import { handleTestLogin } from '@/lib/test-login';
import { db, failure } from '@/lib/server';

async function handle(req: Request) {
  try {
    return await handleTestLogin(req, env, db());
  } catch (e) {
    return failure(e);
  }
}
export const GET = handle;
export const POST = handle;
