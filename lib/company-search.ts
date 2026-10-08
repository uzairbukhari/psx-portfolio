// Search of the shared company directory (`security_catalog`, filled by the PSX directory scraper) so a person can
// find any listed PSX company by symbol or name. Public data only: it never reads a portfolio.
import { readableSector } from './company-directory.ts';

export type CompanySearchHit = { ticker: string; name: string; sector: string };

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchDirectory(db: D1Database, rawQuery: string | null, limit = 15): Promise<CompanySearchHit[]> {
  const query = (rawQuery ?? '').trim().slice(0, 60);
  if (query.length < 1) return [];
  const upper = query.toUpperCase();
  const like = `%${escapeLike(query)}%`;
  const rows = await db
    .prepare(
      `SELECT ticker,name,sector_name FROM security_catalog
       WHERE (ticker LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')
         AND name <> '' AND UPPER(name) <> ticker
         AND COALESCE(listing_status,'listed') <> 'delisted'
         AND COALESCE(security_type,'equity') = 'equity'
       ORDER BY (ticker = ?) DESC, (ticker LIKE ? ESCAPE '\\') DESC, ticker
       LIMIT ?`,
    )
    .bind(like, like, upper, `${escapeLike(upper)}%`, Math.min(Math.max(limit, 1), 30))
    .all<{ ticker: string; name: string; sector_name: string | null }>();
  return rows.results.map((row) => ({ ticker: row.ticker, name: row.name, sector: row.sector_name ? readableSector(row.sector_name) : '' }));
}
