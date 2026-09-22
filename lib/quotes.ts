export type QuoteCacheRow = {
  ticker: string;
  price: number;
  asOf: string;
  quoteDate: string;
  source: string;
  fetchedAt: string;
};
export type EffectiveQuote = {
  price: number;
  asOf: string;
  date: string;
  source: string;
  fetchedAt: string;
  manual?: boolean;
};

function cachedIsNewer(cached: QuoteCacheRow, saved: EffectiveQuote): boolean {
  if (cached.fetchedAt !== saved.fetchedAt) return cached.fetchedAt > saved.fetchedAt;
  return cached.quoteDate > saved.date;
}

export function effectiveQuote(
  saved: EffectiveQuote | undefined,
  cached: QuoteCacheRow | undefined,
): EffectiveQuote | undefined {
  if (saved?.manual) return saved;
  if (!cached) return saved;
  if (saved && !cachedIsNewer(cached, saved)) return saved;
  return {
    price: cached.price,
    asOf: cached.asOf,
    date: cached.quoteDate,
    source: cached.source,
    fetchedAt: cached.fetchedAt,
  };
}

export function mergeEffectiveQuotes(
  quotes: Record<string, EffectiveQuote>,
  cache: QuoteCacheRow[],
): Record<string, EffectiveQuote> {
  const out = { ...quotes };
  for (const row of cache) {
    const merged = effectiveQuote(quotes[row.ticker], row);
    if (merged) out[row.ticker] = merged;
  }
  return out;
}
