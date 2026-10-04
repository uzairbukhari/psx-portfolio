// Stock splits found while importing a broker file. Pure and shared by the AHL, Finqalab and IPO imports.
//
// A split is stored as a normal `stockSplits` entry (trades keep the quantity and price the broker reported;
// the split event converts them), so the import only has to decide which splits are missing from the ledger.
// Two sources: public corporate-action evidence (`corporate_actions`, curated against PSX notices) and a price-break
// heuristic that only ever asks the user, never adds anything on its own. No portfolio data leaves the device.
import { dateOK, today, type Portfolio, type StockSplit } from './portfolio.ts';

export type CorporateAction = {
  ticker: string;
  kind: 'split';
  oldShares: number;
  newShares: number;
  /** First trading day on the new share basis (YYYY-MM-DD). */
  effectiveDate: string;
  sourceUrl: string;
  sourceLabel: string | null;
  verification: 'curated' | 'extracted';
  checkedAt: string;
};

/** A trade (or any dated price) used to decide which splits matter. */
export type Activity = { ticker: string; date: string; price?: number | null };

export type SplitProposal = {
  /** Stable key, also stored as the split's externalId. */
  key: string;
  ticker: string;
  oldShares: number;
  newShares: number;
  date: string;
  sourceUrl: string;
  sourceLabel: string | null;
  verification: CorporateAction['verification'];
};

export type PossibleSplit = {
  key: string;
  ticker: string;
  fromDate: string;
  toDate: string;
  fromPrice: number;
  toPrice: number;
  /** Suggested whole-number ratio (new shares per old share). */
  ratio: number;
};

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / dayMs;
export const splitKey = (ticker: string, date: string, oldShares: number, newShares: number) =>
  `split:${ticker}:${date}:${oldShares}:${newShares}`;

/** True when the ledger already has this split (or one the user deliberately voided) around the same date. */
function ledgerHasSplit(portfolio: Portfolio, ticker: string, date: string, oldShares: number, newShares: number) {
  return (portfolio.stockSplits ?? []).some(
    (s) =>
      s.ticker === ticker &&
      (s.externalId === splitKey(ticker, date, oldShares, newShares) ||
        (s.oldShares * newShares === s.newShares * oldShares && daysBetween(s.date, date) <= 7)),
  );
}

/** Evidence splits the ledger is missing for tickers that were held (or traded) before the split date. */
export function proposeSplits(
  portfolio: Portfolio,
  activity: readonly Activity[],
  evidence: readonly CorporateAction[],
  now: string = today(),
): SplitProposal[] {
  const earliest = new Map<string, string>();
  for (const a of [...activity, ...portfolio.trades.filter((t) => !t.voided)])
    if (!earliest.has(a.ticker) || a.date < earliest.get(a.ticker)!) earliest.set(a.ticker, a.date);
  const out: SplitProposal[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    if (e.kind !== 'split' || !dateOK(e.effectiveDate) || e.effectiveDate > now) continue;
    if (!Number.isSafeInteger(e.oldShares) || !Number.isSafeInteger(e.newShares) || e.oldShares <= 0 || e.newShares <= e.oldShares) continue;
    const first = earliest.get(e.ticker);
    if (!first || first >= e.effectiveDate) continue;
    if (ledgerHasSplit(portfolio, e.ticker, e.effectiveDate, e.oldShares, e.newShares)) continue;
    const key = splitKey(e.ticker, e.effectiveDate, e.oldShares, e.newShares);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key, ticker: e.ticker, oldShares: e.oldShares, newShares: e.newShares, date: e.effectiveDate,
      sourceUrl: e.sourceUrl, sourceLabel: e.sourceLabel, verification: e.verification,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

/**
 * Consecutive trade prices for one ticker that fall by 2x or more with no recorded or proposed split between
 * them: usually a split the evidence table does not know. A prompt for the user, never applied automatically.
 */
export function possibleSplits(
  portfolio: Portfolio,
  activity: readonly Activity[],
  known: readonly Pick<StockSplit, 'ticker' | 'date'>[] = [],
): PossibleSplit[] {
  const all = [
    ...portfolio.trades.filter((t) => !t.voided && t.price !== null).map((t) => ({ ticker: t.ticker, date: t.date, price: t.price })),
    ...activity,
  ].filter((a): a is Activity & { price: number } => typeof a.price === 'number' && a.price > 0);
  const splits = [...(portfolio.stockSplits ?? []).filter((s) => !s.voided), ...known];
  const byTicker = new Map<string, (Activity & { price: number })[]>();
  for (const a of all) (byTicker.get(a.ticker) ?? byTicker.set(a.ticker, []).get(a.ticker)!).push(a);
  const out: PossibleSplit[] = [];
  for (const [ticker, list] of byTicker) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const ratio = a.price / b.price;
      if (ratio < 2) continue;
      if (splits.some((s) => s.ticker === ticker && s.date >= a.date && s.date <= b.date)) continue;
      const key = `possible:${ticker}:${a.date}:${b.date}`;
      if (out.some((o) => o.key === key)) continue;
      out.push({ key, ticker, fromDate: a.date, toDate: b.date, fromPrice: a.price, toPrice: b.price, ratio: Math.max(2, Math.round(ratio)) });
    }
  }
  return out.sort((a, b) => a.toDate.localeCompare(b.toDate) || a.ticker.localeCompare(b.ticker));
}

export function splitFromProposal(p: Pick<SplitProposal, 'key' | 'ticker' | 'oldShares' | 'newShares' | 'date' | 'sourceUrl' | 'sourceLabel'>, id: string): StockSplit {
  return {
    id, ticker: p.ticker, date: p.date, oldShares: p.oldShares, newShares: p.newShares,
    note: `${p.newShares}-for-${p.oldShares} split added while importing, from ${p.sourceLabel ?? 'public corporate-action evidence'}.`.slice(0, 300),
    source: 'import', sourceUrl: p.sourceUrl.slice(0, 500), externalId: p.key,
  };
}

/** The portfolio with the accepted splits added (no-op when none). Used to plan an import on the post-split ledger. */
export function withSplits(portfolio: Portfolio, splits: readonly StockSplit[] | undefined): Portfolio {
  if (!splits?.length) return portfolio;
  const have = new Set((portfolio.stockSplits ?? []).map((s) => s.externalId).filter(Boolean));
  const add = splits.filter((s) => !s.externalId || !have.has(s.externalId));
  return add.length ? { ...portfolio, stockSplits: [...(portfolio.stockSplits ?? []), ...add] } : portfolio;
}

// --- server read (shared D1 table; the slice of D1Database it needs keeps the module free of Workers typings) ---
type ActionDb = { prepare(sql: string): { bind(...args: unknown[]): { all<T>(): Promise<{ results: T[] }> } } };
type StoredAction = {
  ticker: string; effective_date: string; old_shares: number; new_shares: number;
  source_url: string; source_label: string | null; verification: string; checked_at: string;
};
export async function readCorporateActions(db: ActionDb, tickers: string[]): Promise<CorporateAction[]> {
  const out: CorporateAction[] = [];
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const rows = await db
      .prepare(`SELECT ticker,effective_date,old_shares,new_shares,source_url,source_label,verification,checked_at FROM corporate_actions WHERE kind='split' AND ticker IN (${part.map(() => '?').join(',')}) ORDER BY ticker,effective_date`)
      .bind(...part)
      .all<StoredAction>();
    for (const r of rows.results)
      out.push({
        ticker: r.ticker, kind: 'split', oldShares: r.old_shares, newShares: r.new_shares, effectiveDate: r.effective_date,
        sourceUrl: r.source_url, sourceLabel: r.source_label, verification: r.verification === 'curated' ? 'curated' : 'extracted',
        checkedAt: r.checked_at,
      });
  }
  return out;
}
