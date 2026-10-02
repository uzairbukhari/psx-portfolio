// Shared D1-backed reader for `lib/company-facts.ts`. PSX drops Cloudflare egress, so
// the Worker never fetches company pages itself: `scripts/psx-facts-scrape.mjs` (GitHub
// Actions, daily + on demand) writes `company_facts` (one row per ticker, latest scrape)
// and `facts_requests` (last attempt/error per ticker). Everything here is read-only
// except the best-effort dispatch in `gatherFacts`.
import { today } from './portfolio.ts';
import type { CompanyFacts } from './company-facts.ts';
import { classifyFacts, type FactsStatus } from './monthly-picks-flow.ts';
import { requestFacts, type DispatchConfig } from './github-dispatch.ts';

export type FactsResult = CompanyFacts | { ticker: string; unavailable: string };
export type FactsEntry = { status: FactsStatus; facts: CompanyFacts | null };

// D1 allows 100 bound parameters per statement.
const CHUNK = 90;
function chunks(list: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}
type FactsRow = { ticker: string; fetched_on: string; payload?: string };
type RequestRow = { ticker: string; requested_at: string; attempted_at: string | null; error: string | null };

async function read(db: D1Database, tickers: string[], withPayload: boolean): Promise<FactsEntry[]> {
  const unique = [...new Set(tickers)];
  const day = today();
  const facts = new Map<string, FactsRow>();
  const requests = new Map<string, RequestRow>();
  for (const part of chunks(unique)) {
    const marks = part.map(() => '?').join(',');
    const [factRows, requestRows] = await Promise.all([
      db.prepare(`SELECT ticker,fetched_on${withPayload ? ',payload' : ''} FROM company_facts WHERE ticker IN (${marks})`).bind(...part).all<FactsRow>(),
      db.prepare(`SELECT ticker,requested_at,attempted_at,error FROM facts_requests WHERE ticker IN (${marks})`).bind(...part).all<RequestRow>(),
    ]);
    for (const row of factRows.results) facts.set(row.ticker, row);
    for (const row of requestRows.results) requests.set(row.ticker, row);
  }
  return unique.map((ticker) => {
    const row = facts.get(ticker);
    const request = requests.get(ticker);
    let parsed: CompanyFacts | null = null;
    if (withPayload && row?.payload) {
      try { parsed = JSON.parse(row.payload) as CompanyFacts; } catch { parsed = null; }
    }
    const usable = row && (!withPayload || parsed);
    return {
      status: classifyFacts(
        ticker, usable ? row.fetched_on : null,
        request ? { requestedAt: request.requested_at, attemptedAt: request.attempted_at, error: request.error } : null,
        day,
      ),
      facts: parsed,
    };
  });
}

/** Facts plus scrape status for each ticker. */
export const readFacts = (db: D1Database, tickers: string[]) => read(db, tickers, true);
/** Status only (no payload) — cheap enough to list for a whole portfolio. */
export async function readFactsStatus(db: D1Database, tickers: string[]): Promise<FactsStatus[]> {
  return (await read(db, tickers, false)).map((entry) => entry.status);
}

/**
 * Cache-only lookup used for name/sector enrichment when a portfolio is saved. Tickers
 * with no stored facts come back `unavailable` and a scrape is requested in the
 * background so a later save/refresh finds them.
 */
export async function gatherFacts(db: D1Database, config: DispatchConfig, tickers: string[]): Promise<FactsResult[]> {
  const entries = await readFacts(db, tickers);
  const missing = entries.filter((entry) => !entry.facts).map((entry) => entry.status.ticker);
  if (missing.length) await requestFacts(db, config, missing).catch(() => {});
  return entries.map((entry) => entry.facts ?? { ticker: entry.status.ticker, unavailable: 'No PSX company data yet.' });
}
