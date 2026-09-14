import { db, failure, identity } from '@/lib/server';
import { sha256 } from '@/lib/research-jobs';

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'psxrh_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(req: Request) {
  try {
    const userId = await identity(req);
    const rows = await db()
      .prepare('SELECT id,label,created_at,last_seen_at FROM research_helpers WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC')
      .bind(userId)
      .all();
    return Response.json({ helpers: rows.results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await identity(req, true);
    const raw = token();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare('INSERT INTO research_helpers (id,user_id,token_hash,label,created_at) VALUES (?,?,?,?,?)')
      .bind(id, userId, await sha256(raw), 'Mac research helper', now)
      .run();
    return Response.json({ id, token: raw, createdAt: now }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await identity(req, true);
    const id = new URL(req.url).searchParams.get('id');
    await db()
      .prepare('UPDATE research_helpers SET revoked_at=? WHERE id=? AND user_id=?')
      .bind(new Date().toISOString(), id, userId)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
