// Advances, declines, unchanged securities and volume, all computed from ONE coherent dataset (the
// All-Share constituents table of a single scrape). Rows with a missing or invalid price, change or
// volume are excluded and counted, never treated as zero. "Coverage" is the securities in that source
// table: it is not the number of listed companies on PSX.
export type BreadthRow = { symbol: string; price: number | null; change: number | null; volume: number | null };

export type MarketBreadth = {
  advances: number;
  declines: number;
  unchanged: number;
  /** Total traded volume over rows with a valid volume. */
  volume: number;
  /** Rows used for the counts. */
  covered: number;
  /** Rows in the source table. */
  sourceRows: number;
  /** Rows left out because price or change was missing or invalid. */
  excluded: number;
  /** Rows whose volume was unusable (still counted for advance/decline). */
  volumeMissing: number;
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function marketBreadth(rows: BreadthRow[]): MarketBreadth {
  const seen = new Set<string>();
  const out: MarketBreadth = { advances: 0, declines: 0, unchanged: 0, volume: 0, covered: 0, sourceRows: 0, excluded: 0, volumeMissing: 0 };
  for (const row of rows) {
    if (!row || typeof row.symbol !== 'string' || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    out.sourceRows++;
    if (!finite(row.price) || row.price <= 0 || !finite(row.change)) { out.excluded++; continue; }
    out.covered++;
    if (row.change > 0) out.advances++;
    else if (row.change < 0) out.declines++;
    else out.unchanged++;
    if (finite(row.volume) && row.volume >= 0) out.volume += row.volume;
    else out.volumeMissing++;
  }
  return out;
}
