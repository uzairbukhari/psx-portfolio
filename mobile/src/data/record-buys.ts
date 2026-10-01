// The review-and-record sheet (pure): editable share and price text per suggested buy, the live total, and
// conversion to the buys that recordBuys() saves in one revision.
import { round } from '../../../lib/portfolio.ts';
import { parseNumber, type BuyDraft } from './mutations.ts';

export type ReviewRow = { ticker: string; name: string; shares: string; price: string };

/** Anything with the fields of a plan row or a Monthly Picks estimate. */
export type SuggestedBuy = { ticker: string; name: string; shares: number | null; price: number | null };

/** Rows for the sheet: only suggestions with a price and at least one share. */
export function reviewRows(suggestions: SuggestedBuy[]): ReviewRow[] {
  return suggestions
    .filter((s) => s.shares !== null && s.shares > 0 && s.price !== null)
    .map((s) => ({ ticker: s.ticker, name: s.name, shares: String(s.shares), price: String(s.price) }));
}

/** Fees the buy is expected to cost at the fee estimate (percent of the trade value). */
export const estimatedFees = (shares: number, price: number, feePct: number) => round((shares * price * feePct) / 100);

export type ReviewResult = {
  buys: BuyDraft[];
  /** Row problems by ticker; empty when every row can be recorded. */
  errors: Record<string, string>;
  /** Shares times price. */
  gross: number;
  fees: number;
  total: number;
};

export function parseReview(rows: ReviewRow[], feePct: number): ReviewResult {
  const buys: BuyDraft[] = [];
  const errors: Record<string, string> = {};
  let gross = 0;
  let fees = 0;
  for (const r of rows) {
    const shares = parseNumber(r.shares);
    const price = parseNumber(r.price);
    if (shares === null || !Number.isInteger(shares) || shares <= 0) {
      errors[r.ticker] = 'Enter a whole number of shares.';
      continue;
    }
    if (price === null || !(price > 0)) {
      errors[r.ticker] = 'Enter the price per share.';
      continue;
    }
    const fee = estimatedFees(shares, price, feePct);
    buys.push({ ticker: r.ticker, shares, price, fees: fee });
    gross += shares * price;
    fees += fee;
  }
  return { buys, errors, gross: round(gross), fees: round(fees), total: round(gross + fees) };
}
