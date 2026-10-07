// Reads the shared gold and silver rates. Public data: takes no user and no portfolio, and no parameters, so what
// is asked for never says what anyone owns.
import type { MetalRateRow } from './metal-rates.ts';

type RateDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
  };
};
type StoredRate = {
  date: string;
  metal: string;
  kind: string;
  pkr_per_tola: number;
  source_url: string;
  source_label: string | null;
  fetched_at: string;
};

/** The last five years of rates (history for the charts), oldest first. */
export async function readMetalRates(
  db: RateDb,
  today: string,
): Promise<MetalRateRow[]> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 1830 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .prepare(
      'SELECT date,metal,kind,pkr_per_tola,source_url,source_label,fetched_at FROM metal_rates WHERE date>=? ORDER BY date,metal,kind',
    )
    .bind(from)
    .all<StoredRate>();
  return rows.results
    .filter(
      (r) =>
        (r.metal === 'gold' || r.metal === 'silver') &&
        (r.kind === 'local' || r.kind === 'international'),
    )
    .map((r) => ({
      date: r.date,
      metal: r.metal as MetalRateRow['metal'],
      kind: r.kind as MetalRateRow['kind'],
      pkrPerTola: r.pkr_per_tola,
      sourceUrl: r.source_url,
      sourceLabel: r.source_label ?? undefined,
      fetchedAt: r.fetched_at,
    }));
}
