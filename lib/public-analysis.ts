// Public Monthly Picks analysis for client-named tickers: scraped PSX company facts, the shared quote cache and
// the deterministic quant score. Nothing here reads, stores or receives anything private. The server does not
// know the user's money, holdings, shortlist history or results; the client turns this analysis into picks and
// sizes them against its own decrypted holdings (lib/picks-local.ts).
import { today } from './portfolio.ts';
import { readFacts } from './company-facts-store.ts';
import { computeMetrics, overlayQuote, quantScore, type CompanyMetrics } from './company-facts.ts';
import { readQuoteRows } from './quote-cache.ts';
import { FACTS_MAX_AGE_DAYS, unavailableReason } from './monthly-picks-flow.ts';
import type { PublicAnalysis } from './public-analysis-types.ts';
import type { SnapshotCompany } from './monthly-picks-ai.ts';

export type { PublicAnalysis };

/** KSE-100 as last stored by the market scraper. */
async function indexContext(db: D1Database) {
  try {
    const saved = await db.prepare("SELECT payload FROM market_summary_refreshes WHERE id='latest'").first<{ payload: string }>();
    const index = saved ? (JSON.parse(saved.payload) as { index?: { close?: number; asOf?: string } }).index : undefined;
    return index && Number.isFinite(index.close) && index.asOf ? { code: 'KSE100', close: Number(index.close), asOf: index.asOf } : null;
  } catch { return null; }
}

export async function buildPublicAnalysis(db: D1Database, tickers: string[]): Promise<PublicAnalysis> {
  const dataAsOf = today();
  const entries = await readFacts(db, tickers);
  const quotes = new Map((await readQuoteRows(db).catch(() => [])).map((quote) => [quote.ticker, quote]));
  const overlayFor = (ticker: string, facts: NonNullable<(typeof entries)[number]['facts']>) => {
    const quote = quotes.get(ticker);
    return overlayQuote(facts, quote && { price: quote.price, quoteDate: quote.quote_date, fetchedAt: quote.fetched_at });
  };
  const metrics: CompanyMetrics[] = entries.map(({ status, facts }) => {
    if (!facts) return computeMetrics({ ticker: status.ticker, unavailable: unavailableReason(status) }, dataAsOf);
    // Facts older than the freshness limit stay visible in coverage but can never support a new pick.
    if (status.state === 'stale')
      return computeMetrics({ ticker: status.ticker, unavailable: `Company data is ${status.ageDays} days old (limit ${FACTS_MAX_AGE_DAYS}); the latest scrape failed or is pending.` }, dataAsOf);
    return computeMetrics(overlayFor(status.ticker, facts), dataAsOf);
  });
  const companies: SnapshotCompany[] = entries.map(({ status, facts }, index) => {
    const fresh = facts && overlayFor(status.ticker, facts);
    return {
      ticker: status.ticker,
      name: fresh ? fresh.name : status.ticker,
      sector: fresh ? fresh.sector : 'Unknown',
      source: fresh ? fresh.source : null,
      price: fresh ? fresh.price : null,
      priceDate: fresh ? fresh.priceDate : null,
      metrics: metrics[index],
    };
  });
  return {
    dataAsOf,
    companies,
    scores: quantScore(metrics),
    index: await indexContext(db),
    facts: entries.map(({ status }) => ({
      ticker: status.ticker, state: status.state, fetchedOn: status.fetchedOn, ageDays: status.ageDays, error: status.error,
    })),
    factsMaxAgeDays: FACTS_MAX_AGE_DAYS,
  };
}
