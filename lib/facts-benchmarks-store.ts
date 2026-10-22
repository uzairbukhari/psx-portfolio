// Reads the daily market breakpoints the facts scraper writes (public numbers; see lib/facts-benchmarks.ts).
import { today } from './portfolio.ts';
import { parseBenchmarks, type FactsBenchmarks } from './facts-benchmarks.ts';

/** The latest usable breakpoints, or null (no row yet, too old, or unreadable) so scoring falls back to the shortlist. */
export async function readBenchmarks(db: D1Database): Promise<FactsBenchmarks | null> {
  try {
    const row = await db.prepare("SELECT payload FROM facts_benchmarks WHERE id='latest'").first<{ payload: string }>();
    return row ? parseBenchmarks(JSON.parse(row.payload), today()) : null;
  } catch {
    return null;
  }
}
