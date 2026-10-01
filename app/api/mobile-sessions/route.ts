import type { MobileSessionsResponse } from '@/lib/api-types';
import { identity, failure } from '@/lib/server';
import { listMobileSessions, revokeMobileSession } from '@/lib/mobile-sessions';
import { UserError } from '@/lib/user-error';

export async function GET(req: Request) {
  try {
    const email = await identity(req);
    return Response.json(
      { sessions: await listMobileSessions(email) } satisfies MobileSessionsResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}

// Sign out one device: DELETE /api/mobile-sessions?id=<session id>
export async function DELETE(req: Request) {
  try {
    const email = await identity(req, true);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new UserError('Missing session id.');
    if (!(await revokeMobileSession(email, id))) throw new UserError('Session not found.', 404);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
