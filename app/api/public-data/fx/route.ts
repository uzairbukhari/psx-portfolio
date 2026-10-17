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
      `fx2:${day}`,
      900,
      () => readFxRates(db(), day),
      waitUntil,
      undefined,
      // Do not keep an empty answer: rates arrive from a scraper, and a page loaded just before it ran must not wait out the cache.
      (rates) => rates.rates.length > 0,
    );
    return Response.json(body, {
      headers: {
        'Cache-Control': body.rates.length ? 'private, max-age=900' : 'no-store',
      },
    });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
