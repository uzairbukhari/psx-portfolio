// "Your picks so far": for each of the last months, what Monthly Picks suggested, what was actually bought through it and
// how those buys have done against the KSE-100 bought on the same days with the same money. Pure and shared-safe: no clock,
// the caller passes today's date, the ledger and the index closes. The comparison is a fact about past buys, not a forecast.
import type { Quote, Trade } from './portfolio.ts';
import type { StoredPicksRun } from './picks-local.ts';
import { pktDate, type PricePoint } from './price-history.ts';

export type PickMonthTrack = {
  month: string;
  runId: string;
  suggested: string[];
  bought: { ticker: string; costPkr: number; valuePkr: number | null }[];
  boughtPkr: number;
  /** Suggested companies that were bought / suggested, in whole companies. */
  followed: { bought: number; of: number };
  /** Value now over cost, as a percentage. Null when a bought company has no price. */
  returnPct: number | null;
  /** The KSE-100 over the same days with the same money. Null when the index history does not cover the buys. */
  indexPct: number | null;
};

export type PicksTrack = { months: PickMonthTrack[]; totalBoughtPkr: number; returnPct: number | null; indexPct: number | null };

const round1 = (n: number) => Math.round(n * 10) / 10;

export function picksTrack(input: {
  trades: Trade[];
  runs: StoredPicksRun[];
  quotes: Record<string, Pick<Quote, 'price'> | undefined>;
  index: PricePoint[];
  asOf: string;
  months?: number;
}): PicksTrack {
  const closes = input.index
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .map(([sec, close]): [string, number] => [pktDate(sec), close])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const closeOnOrBefore = (date: string) => {
    let found: number | null = null;
    for (const [d, c] of closes) {
      if (d > date) break;
      found = c;
    }
    return found;
  };
  const latest = closeOnOrBefore(input.asOf);

  const byRun = new Map<string, Trade[]>();
  for (const trade of input.trades) {
    if (trade.voided || trade.kind !== 'buy' || !trade.picksRunId || trade.price === null) continue;
    byRun.set(trade.picksRunId, [...(byRun.get(trade.picksRunId) ?? []), trade]);
  }

  const months: PickMonthTrack[] = [];
  for (const run of input.runs) {
    const trades = byRun.get(run.id);
    if (!trades?.length) continue;
    const cost = new Map<string, number>();
    const shares = new Map<string, number>();
    let indexValue = 0;
    let indexCovered = latest !== null;
    for (const t of trades) {
      const paid = t.shares * (t.price ?? 0) + t.fees;
      cost.set(t.ticker, (cost.get(t.ticker) ?? 0) + paid);
      shares.set(t.ticker, (shares.get(t.ticker) ?? 0) + t.shares);
      const at = closeOnOrBefore(t.date);
      if (at === null || latest === null) indexCovered = false;
      else indexValue += paid * (latest / at);
    }
    const bought = [...cost].map(([ticker, costPkr]) => {
      const price = input.quotes[ticker]?.price;
      return { ticker, costPkr: Math.round(costPkr * 100) / 100, valuePkr: price ? Math.round((shares.get(ticker) ?? 0) * price * 100) / 100 : null };
    });
    const boughtPkr = bought.reduce((n, b) => n + b.costPkr, 0);
    const priced = bought.every((b) => b.valuePkr !== null);
    const value = bought.reduce((n, b) => n + (b.valuePkr ?? 0), 0);
    const suggested = (run.result?.picks ?? []).map((p) => p.ticker);
    months.push({
      month: run.month,
      runId: run.id,
      suggested,
      bought,
      boughtPkr: Math.round(boughtPkr * 100) / 100,
      followed: { bought: suggested.filter((t) => cost.has(t)).length, of: suggested.length },
      returnPct: priced && boughtPkr > 0 ? round1((value / boughtPkr - 1) * 100) : null,
      indexPct: indexCovered && boughtPkr > 0 ? round1((indexValue / boughtPkr - 1) * 100) : null,
    });
  }
  months.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  const shown = months.slice(0, input.months ?? 6);

  const sum = shown.reduce((n, m) => n + m.boughtPkr, 0);
  const comparable = shown.filter((m) => m.returnPct !== null && m.indexPct !== null);
  const weight = comparable.reduce((n, m) => n + m.boughtPkr, 0);
  const blend = (pick: (m: PickMonthTrack) => number | null) =>
    weight > 0 ? round1(comparable.reduce((n, m) => n + (m.boughtPkr * (pick(m) ?? 0)), 0) / weight) : null;
  return { months: shown, totalBoughtPkr: Math.round(sum * 100) / 100, returnPct: blend((m) => m.returnPct), indexPct: blend((m) => m.indexPct) };
}
