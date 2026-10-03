// GET /api/public-data?tickers=A,B: shared market caches for tickers the client names. Free of Worker-only imports
// for testing. Deliberately takes no user: nothing here depends on, loads or stores anyone's portfolio.
import type { PublicDataResponse } from './api-types.ts';
import { readAnnouncements } from './dividend-announcements.ts';
import { readFaceValues } from './face-values.ts';
import { cleanLookupTickers } from './company-resolver.ts';
import { readQuoteRows } from './quote-cache.ts';
import { UserError } from './user-error.ts';

export const MAX_PUBLIC_TICKERS = 150;

export async function readPublicData(db: D1Database, tickersInput: unknown): Promise<PublicDataResponse> {
  const tickers = cleanLookupTickers(tickersInput, MAX_PUBLIC_TICKERS + 1);
  if (tickers.length > MAX_PUBLIC_TICKERS) throw new UserError(`Ask for at most ${MAX_PUBLIC_TICKERS} companies at a time.`);
  if (!tickers.length) return { tickers: [], quoteRows: [], announcements: [], faceValues: {} };
  const wanted = new Set(tickers);
  const [rows, announcements, faceValues] = await Promise.all([
    readQuoteRows(db).catch(() => []),
    readAnnouncements(db, tickers).catch(() => []),
    readFaceValues(db, tickers).catch(() => ({})),
  ]);
  return { tickers, quoteRows: rows.filter((row) => wanted.has(row.ticker)), announcements, faceValues };
}
