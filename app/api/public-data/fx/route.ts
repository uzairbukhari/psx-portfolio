import { waitUntil } from 'cloudflare:workers';
import { db, failure, identity } from '@/lib/server';
import { edgeCached } from '@/lib/edge-cache';
import { readFxRates } from '@/lib/fx-rates-store';
import { today } from '@/lib/portfolio';

/** Foreign currency rates. Takes no parameters, so the request says nothing about what anyone holds. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const day = today();
    // Same for every user and refreshed by a scraper twice a day: the edge cache saves the D1 read on almost every load.
    const body = await edgeCached(
      `fx:${day}`,
      900,
      () => readFxRates(db(), day),
      waitUntil,
    );
    return Response.json(body, {
      headers: { 'Cache-Control': 'private, max-age=900' },
    });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
