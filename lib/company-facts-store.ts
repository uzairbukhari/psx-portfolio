// Shared D1-backed cache for `lib/company-facts.ts`. One row per ticker per PKT
// calendar day, so re-running Monthly Picks (or two users sharing a ticker) the same
// day costs zero extra PSX fetches. A per-ticker fetch failure never fails the run:
// it becomes an `unavailable` fact the scorer treats as a neutral/zero entry.
import { db } from './server.ts';
import { today } from './portfolio.ts';
import { fetchCompanyFacts, type CompanyFacts } from './company-facts.ts';

type FactsRow = { ticker: string; fetched_on: string; payload: string; fetched_at: string };
export type FactsResult = CompanyFacts | { ticker: string; unavailable: string };

export async function gatherFacts(tickers: string[]): Promise<FactsResult[]> {
  const uniqueTickers = [...new Set(tickers)];
  if (!uniqueTickers.length) return [];
  const day = today();
  const placeholders = uniqueTickers.map(() => '?').join(',');
  const cached = (await db().prepare(`SELECT * FROM company_facts WHERE fetched_on=? AND ticker IN (${placeholders})`)
    .bind(day, ...uniqueTickers).all<FactsRow>()).results;
  const cachedByTicker = new Map(cached.map((row) => [row.ticker, JSON.parse(row.payload) as CompanyFacts]));
  const missing = uniqueTickers.filter((ticker) => !cachedByTicker.has(ticker));

  const fetched = await Promise.allSettled(missing.map((ticker) => fetchCompanyFacts(ticker)));
  const results: FactsResult[] = uniqueTickers.map((ticker) => cachedByTicker.get(ticker)).filter((v): v is CompanyFacts => Boolean(v));
  const writes: D1PreparedStatement[] = [];
  missing.forEach((ticker, index) => {
    const outcome = fetched[index];
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
      writes.push(db().prepare('INSERT OR REPLACE INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)')
        .bind(ticker, day, JSON.stringify(outcome.value), outcome.value.fetchedAt));
    } else {
      results.push({ ticker, unavailable: outcome.reason instanceof Error ? outcome.reason.message : 'PSX fetch failed.' });
    }
  });
  if (writes.length) await db().batch(writes);
  const byTicker = new Map(results.map((r) => [r.ticker, r]));
  return uniqueTickers.map((ticker) => byTicker.get(ticker)!);
}
