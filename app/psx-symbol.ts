import type { Quote } from '@/lib/portfolio';

type QuoteResponse = {
  quotes?: Record<string, Quote>;
  errors?: string[];
  reasons?: Record<string, string>;
  error?: string;
};

/** Confirms that PSX currently returns a quote for a manually entered symbol. */
export async function verifyPsxSymbol(ticker: string): Promise<Quote> {
  const response = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: [ticker] }),
  });
  const data = (await response.json()) as QuoteResponse;
  const quote = data.quotes?.[ticker];
  if (response.ok && quote) return quote;
  const reason = data.reasons?.[ticker] || data.error;
  throw Error(
    reason
      ? `${ticker} could not be confirmed on PSX: ${reason}`
      : `${ticker} is not available as a current PSX symbol.`,
  );
}
