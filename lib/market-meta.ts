// Types only (no runtime imports), so the mobile bundle can share them via lib/api-types.ts.
export type Freshness = 'fresh' | 'delayed' | 'stale' | 'unavailable';
export type TimestampPrecision = 'second' | 'minute' | 'day' | 'unknown';

/** Metadata shared by prices, indices, facts and history. Additive on every response that carries market data. */
export type DataMeta = {
  provider: string;
  sourceUrl: string | null;
  /** When the source says the value was observed (null when it does not say). */
  sourceTimestamp: string | null;
  /** When this system retrieved it. Never a substitute for the source time. */
  fetchedAt: string | null;
  /** Trading session (PKT date) the value belongs to. */
  session: string | null;
  /** True when `session` was guessed from the fetch time because the source gave none. */
  sessionInferred: boolean;
  timestampPrecision: TimestampPrecision;
  freshness: Freshness;
  /** Plain-language explanation of `freshness`. */
  reason: string;
  ageSeconds: number | null;
  lastSuccessAt: string | null;
  lastFailure: { at: string; message: string } | null;
};
