import { db, failure, identity } from '@/lib/server';
import { readMetalRates } from '@/lib/metal-rates-store';
import { today } from '@/lib/portfolio';

/** Gold and silver rates. Takes no parameters, so the request says nothing about what anyone holds. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const rates = await readMetalRates(db(), today());
    return Response.json({ rates }, { headers: { 'Cache-Control': 'private, max-age=900' } });
  } catch (e) {
    return failure(e);
  }
}
