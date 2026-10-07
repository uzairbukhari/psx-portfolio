import type { DeleteAccountRequest, DeleteAccountResponse, MeResponse } from '@/lib/api-types';
import { env } from 'cloudflare:workers';
import { getViewer } from '@/lib/auth';
import { deleteUserEvents } from '@/lib/analytics-store';
import { accountDeletionStatements, confirmationMatches } from '@/lib/account-deletion';
import { db, failure, identity, vaultDb } from '@/lib/server';
import { deleteVault } from '@/lib/vault-store';
import { serializeExpiredCookie } from '@/lib/session';
import { UserError } from '@/lib/user-error';

export async function GET() {
  try {
    const viewer = await getViewer();
    if (!viewer) throw new UserError('Sign in to continue.', 401);
    return Response.json(
      {
        email: viewer.email,
        name: viewer.name,
        picture: viewer.picture,
        role: viewer.role,
      } satisfies MeResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}

/**
 * Permanently deletes the signed-in user's encrypted vault and every per-user row (see lib/account-deletion.ts).
 * Shared caches are untouched. The body must carry `{ confirm: "<your email>" }`.
 */
export async function DELETE(req: Request) {
  try {
    const email = (await identity(req, true)).toLowerCase();
    const body = (await req.json().catch(() => null)) as Partial<DeleteAccountRequest> | null;
    if (!confirmationMatches(body?.confirm, email))
      throw new UserError('Type your email address to confirm deleting your account.', 400);
    // The encrypted vault goes first: it is the data that matters most, and the deletion is idempotent so a
    // failed second step can simply be retried.
    await deleteVault(vaultDb(), email);
    const database = db();
    await database.batch(accountDeletionStatements().map((sql) => database.prepare(sql).bind(email)));
    await deleteUserEvents(database, email, env.SESSION_SECRET ?? '').catch((e) => console.error('Could not delete usage events', e));
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', serializeExpiredCookie('session'));
    return Response.json({ deleted: true } satisfies DeleteAccountResponse, { headers });
  } catch (e) {
    return failure(e);
  }
}
