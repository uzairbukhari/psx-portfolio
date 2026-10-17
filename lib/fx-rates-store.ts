// Reads the shared foreign currency rates. Public data: takes no user and no portfolio, and no parameters, so what
// is asked for never says what anyone owns. Reads about 60 recent rows plus at most 36 packed history rows.
import {
  unpackYears,
  type FxRateRow,
  type FxRatesResponse,
  isCurrencyCode,
} from './fx-rates.ts';

type RateDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
  };
};
type StoredRate = {
  currency: string;
  kind: string;
  date: string;
  pkr_per_unit: number;
  source_url: string;
  source_label: string | null;
  fetched_at: string;
};

/** The newest ten days of rates with their sources, and the packed history of the last six years. */
export async function readFxRates(
  db: RateDb,
  today: string,
): Promise<FxRatesResponse> {
  const recentFrom = new Date(
    Date.parse(`${today}T00:00:00Z`) - 10 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const firstYear = String(Number(today.slice(0, 4)) - 5);
  const [recent, packed] = await Promise.all([
    db
      .prepare(
        'SELECT currency,kind,date,pkr_per_unit,source_url,source_label,fetched_at FROM fx_rates WHERE date>=? ORDER BY date,currency,kind',
      )
      .bind(recentFrom)
      .all<StoredRate>(),
    db
      .prepare(
        'SELECT currency,kind,year,closes FROM fx_rate_history WHERE year>=?',
      )
      .bind(firstYear)
      .all<{ currency: string; kind: string; closes: string }>(),
  ]);
  const rates: FxRateRow[] = recent.results.flatMap((r) =>
    isCurrencyCode(r.currency) &&
    (r.kind === 'open_market' || r.kind === 'interbank')
      ? [
          {
            date: r.date,
            currency: r.currency,
            kind: r.kind,
            pkrPerUnit: r.pkr_per_unit,
            sourceUrl: r.source_url,
            sourceLabel: r.source_label ?? undefined,
            fetchedAt: r.fetched_at,
          },
        ]
      : [],
  );
  return { rates, history: unpackYears(packed.results) };
}
