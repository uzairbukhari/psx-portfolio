import { db, identity, failure } from '@/lib/server';
import { searchDirectory } from '@/lib/company-search';

/** Directory search for the company picker: ?q=meezan. Public data only; never reads a portfolio. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const hits = await searchDirectory(db(), new URL(req.url).searchParams.get('q'));
    return Response.json({ companies: hits }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
