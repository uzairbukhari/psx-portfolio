import { db, failure, identity } from '@/lib/server';
import { assertClearConfirmed, clearUserData } from '@/lib/user-data-reset';

/** Deletes the signed-in user's own holdings data (portfolio and Monthly Picks runs). Body: `{ confirm: true }`. */
export async function DELETE(req: Request) {
  try {
    const email = await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
    assertClearConfirmed(body.confirm);
    await clearUserData(db(), email);
    return Response.json({ cleared: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
