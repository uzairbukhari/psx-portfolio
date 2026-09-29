// Fills in real name/sector for brand-new tickers being saved to a portfolio (manual
// "Add company", AHL import, Finqalab import all push a placeholder `name: ticker,
// sector: ''` — see app/ahl-import.ts / app/finqalab-import.ts / app/portfolio.tsx).
// Only tickers absent from the previously stored portfolio are touched, so a user's
// manual edits to an existing company's name/sector are never overwritten.
// No D1/Worker imports here on purpose — this stays a pure module so it can be
// unit-tested with `node --test` (see tests/company-enrichment.test.mjs); the
// D1-backed fact lookup itself lives in company-facts-store.ts and is called by
// app/api/portfolio/route.ts.
import type { Company, Portfolio } from './portfolio.ts';
import type { FactsResult } from './company-facts-store.ts';
import type { CompanyFacts } from './company-facts.ts';

export function titleCaseSector(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isAvailable(facts: FactsResult): facts is CompanyFacts {
  return !('unavailable' in facts);
}

/**
 * Mutates `companies` in place, overwriting name/sector for any ticker `facts`
 * covers. Tickers PSX couldn't fetch are left untouched (client-sent placeholder
 * survives) so a save never fails on this.
 */
export function applyFacts(companies: Company[], facts: FactsResult[]): void {
  const byTicker = new Map(facts.filter(isAvailable).map((f) => [f.ticker, f]));
  for (const company of companies) {
    const found = byTicker.get(company.ticker);
    if (!found) continue;
    company.name = found.name;
    company.sector = titleCaseSector(found.sector);
  }
}

/** Tickers present in `incoming` but not in `previous` — i.e. just created/imported. */
export function newTickers(previous: Portfolio | null, incoming: Portfolio): string[] {
  const previousTickers = new Set(
    (previous?.companies ?? []).map((c) => c.ticker),
  );
  return incoming.companies
    .map((c) => c.ticker)
    .filter((ticker) => !previousTickers.has(ticker));
}
