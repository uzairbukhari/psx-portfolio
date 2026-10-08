import { db, identity, failure } from '@/lib/server';
import { allDirectory, searchDirectory } from '@/lib/company-search';

/** Directory search for the company picker: ?q=meezan, or ?all=1 for the whole list. Public data only; never reads a portfolio. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const params = new URL(req.url).searchParams;
    if (params.get('all') === '1')
      return Response.json({ companies: await allDirectory(db()) }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
    const hits = await searchDirectory(db(), params.get('q'));
    return Response.json({ companies: hits }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
