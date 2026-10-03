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
import type { CompanyFacts, FactsResult } from './company-facts.ts';
import type { CompanyLookup } from './api-types.ts';
import { isPlaceholderName } from './company-directory.ts';

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

/** A company whose name is still the ticker (or empty) or that has no sector: details a lookup can fill in. */
export const hasPlaceholderDetails = (company: Pick<Company, 'ticker' | 'name' | 'sector'>) =>
  isPlaceholderName(company.name, company.ticker) || !(company.sector ?? '').trim();

/**
 * Applies resolved directory details to `companies` in place and returns the tickers it changed.
 *  - `replace` tickers (just added by this save) take the directory's name and sector outright: the symbol's
 *    identity is shared, so the verified values win over whatever a statement or form carried;
 *  - every other ticker is only repaired where a field is still a placeholder, so an intentional
 *    rename or sector choice the user made on an existing company is never touched;
 *  - companies the lookup could not resolve are left exactly as they are.
 * Account-specific settings (target, approval, note, face value, ...) are never read or written.
 */
export function applyLookups(companies: Company[], lookups: CompanyLookup[], replace: ReadonlySet<string> = new Set()): string[] {
  const byTicker = new Map(lookups.filter((l) => l.state === 'resolved' && l.company).map((l) => [l.ticker, l.company!]));
  const changed: string[] = [];
  for (const company of companies) {
    const found = byTicker.get(company.ticker);
    if (!found) continue;
    const before = `${company.name}\u0000${company.sector}`;
    if (replace.has(company.ticker) || isPlaceholderName(company.name, company.ticker)) company.name = found.name;
    if (replace.has(company.ticker) || !(company.sector ?? '').trim()) company.sector = found.sector;
    if (`${company.name}\u0000${company.sector}` !== before) changed.push(company.ticker);
  }
  return changed;
}
