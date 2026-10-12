import { listInternalAccounts, removeInternalAccount, setInternalAccount } from '@/lib/internal-accounts';
import { readLimited } from '@/lib/read-limited';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

/** Internal accounts (super admins and test accounts), super admin only. Test accounts are left out of usage analytics. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    return Response.json({ accounts: await listInternalAccounts(db()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const actor = await requireSuperAdmin(req, true);
    const body = JSON.parse(new TextDecoder().decode(await readLimited(req, 4_000, 'Request is too large.'))) as Record<string, unknown>;
    await setInternalAccount(db(), actor, { email: body.email, role: body.role, note: body.note, confirmEmail: body.confirmEmail });
    return Response.json({ accounts: await listInternalAccounts(db()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error instanceof SyntaxError ? new UserError('Invalid request.', 400) : error);
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireSuperAdmin(req, true);
    await removeInternalAccount(db(), actor, new URL(req.url).searchParams.get('email'));
    return Response.json({ accounts: await listInternalAccounts(db()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
