// Shared security catalog: every symbol PSX lists in a validated All-Share observation, with the name PSX
// prints. It is NOT a count of listed companies and records no issuer identity or security type it was
// not told. Used to give brand-new portfolio tickers a real name when no company facts exist yet.
import type { Company } from './portfolio.ts';

export type CatalogEntry = { ticker: string; name: string };

export function catalogUpsertSql(rows: number): string {
  return `INSERT INTO security_catalog (ticker,name,source,first_seen_at,last_seen_at)
          VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?)').join(',')}
          ON CONFLICT(ticker) DO UPDATE SET name=excluded.name, source=excluded.source, last_seen_at=excluded.last_seen_at
          WHERE excluded.last_seen_at >= security_catalog.last_seen_at`;
}
/** Bound values per row for `catalogUpsertSql` (first and last seen start equal). */
export const catalogRowParams = (entry: CatalogEntry, source: string, at: string) => [entry.ticker, entry.name, source, at, at];

/** Rows per statement stay under D1's 100 bound-parameter limit (5 per row). */
export const CATALOG_CHUNK = 19;

/**
 * Names brand-new placeholder companies (name equal to ticker, or empty) from the catalog. A company whose
 * name the user, an import or PSX facts already set is never touched.
 */
export function applyCatalog(companies: Company[], catalog: CatalogEntry[]): void {
  const byTicker = new Map(catalog.map((entry) => [entry.ticker, entry]));
  for (const company of companies) {
    const found = byTicker.get(company.ticker);
    if (found && (!company.name || company.name === company.ticker)) company.name = found.name;
  }
}

/** Catalog rows for the given tickers (chunked under D1 bound-parameter limits). */
export async function readCatalog(db: D1Database, tickers: string[]): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const rows = await db.prepare(`SELECT ticker,name FROM security_catalog WHERE ticker IN (${part.map(() => '?').join(',')})`).bind(...part).all<CatalogEntry>();
    out.push(...rows.results);
  }
  return out;
}
