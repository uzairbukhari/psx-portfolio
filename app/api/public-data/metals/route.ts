import { waitUntil } from 'cloudflare:workers';
import { db, failure, identity } from '@/lib/server';
import { edgeCached } from '@/lib/edge-cache';
import { readMetalRates } from '@/lib/metal-rates-store';
import { today } from '@/lib/portfolio';

/** Gold and silver rates. Takes no parameters, so the request says nothing about what anyone holds. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const day = today();
    // Same for every user and refreshed by a scraper a few times a day: a short edge cache saves a D1 read per page load.
    const rates = await edgeCached(`metals:${day}`, 300, () => readMetalRates(db(), day), waitUntil);
    return Response.json({ rates }, { headers: { 'Cache-Control': 'private, max-age=900' } });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
