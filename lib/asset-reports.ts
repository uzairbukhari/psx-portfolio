// Reports for portfolios that hold only one kind of non-stock asset: mutual funds, or gold/silver. Pure, so the web
// and the tests share it. Everything here is derived from the decrypted ledger plus public prices.
import type { Asset, MetalAsset } from './assets.ts';
import { metalPosition, valueMetal } from './assets.ts';
import type { FundAsset } from './funds.ts';
import { valueFund } from './funds.ts';
import type { FundNavRow } from './mufap.ts';
import { purity, TOLA_GRAMS, type Metal, type MetalRateRow } from './metal-rates.ts';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ReportMode = 'stocks' | 'funds' | 'metal';

/** Which report set a portfolio gets: only when it has no stock activity and its assets are all funds, or all gold/silver. */
export function reportMode(p: {
  trades: { voided?: boolean }[];
  dividends?: { voided?: boolean }[];
  assets?: Asset[];
}): ReportMode {
  if (p.trades.some((t) => !t.voided) || p.dividends?.some((d) => !d.voided))
    return 'stocks';
  const live = p.assets ?? [];
  if (!live.length) return 'stocks';
  if (live.every((a) => a.kind === 'fund')) return 'funds';
  if (live.every((a) => a.kind === 'metal')) return 'metal';
  return 'stocks';
}

export type MonthPoint = {
  month: string;
  invested: number;
  cumulative: number;
  byAsset: Record<string, number>;
};

/** Monthly purchase totals (gaps filled with zero up to the current month) with a running total. */
function monthly(
  buys: { date: string; amount: number; key: string }[],
  asOf: string,
): MonthPoint[] {
  if (!buys.length) return [];
  const months = new Map<string, MonthPoint>();
  for (const b of buys) {
    const month = b.date.slice(0, 7);
    const point = months.get(month) ?? {
      month,
      invested: 0,
      cumulative: 0,
      byAsset: {},
    };
    point.invested = cents(point.invested + b.amount);
    point.byAsset[b.key] = cents((point.byAsset[b.key] ?? 0) + b.amount);
    months.set(month, point);
  }
  const first = [...months.keys()].sort()[0];
  const last = asOf.slice(0, 7) > [...months.keys()].sort().at(-1)! ? asOf.slice(0, 7) : [...months.keys()].sort().at(-1)!;
  const out: MonthPoint[] = [];
  let [y, m] = first.split('-').map(Number);
  let running = 0;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const point = months.get(key) ?? { month: key, invested: 0, cumulative: 0, byAsset: {} };
    running = cents(running + point.invested);
    out.push({ ...point, cumulative: running });
    if (key >= last) break;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type FundReport = {
  monthly: MonthPoint[];
  funds: { id: string; name: string; invested: number; value: number | null }[];
  invested: number;
  value: number | null;
  gain: number | null;
  dividends: number;
};

export function fundReport(
  assets: Asset[],
  navs: FundNavRow[],
  asOf: string,
): FundReport {
  const funds = assets.filter((a): a is FundAsset => a.kind === 'fund');
  const buys = funds.flatMap((f) =>
    f.entries
      .filter((e) => !e.voided && e.type === 'buy' && e.amount !== null)
      .map((e) => ({ date: e.date, amount: e.amount!, key: f.id })),
  );
  const valued = funds.map((f) => ({ f, v: valueFund(f, navs, asOf) }));
  const rows = funds
    .map((f, i) => ({
      id: f.id,
      name: f.name,
      invested: cents(
        buys.filter((b) => b.key === f.id).reduce((t, b) => t + b.amount, 0),
      ),
      value: valued[i].v.value,
    }))
    .sort((a, b) => b.invested - a.invested);
  const values = valued.map((x) => x.v.value);
  const costs = valued.map((x) => x.v.cost);
  const value = values.some((v) => v === null)
    ? null
    : cents(values.reduce<number>((t, v) => t + (v ?? 0), 0));
  const cost = costs.some((c) => c === null)
    ? null
    : cents(costs.reduce<number>((t, c) => t + (c ?? 0), 0));
  return {
    monthly: monthly(buys, asOf),
    funds: rows,
    invested: cents(buys.reduce((t, b) => t + b.amount, 0)),
    value,
    gain: value === null || cost === null ? null : cents(value - cost),
    dividends: cents(valued.reduce((t, x) => t + x.v.dividends, 0)),
  };
}

export type RatePoint = { date: string; rate: number; kind: 'local' | 'international' };
export type MetalReport = {
  metal: Metal;
  monthly: MonthPoint[];
  history: RatePoint[];
  grams: number;
  /** Average cost per tola of pure metal; null while any cost is unknown or nothing is held. */
  averageCostPerTola: number | null;
  cost: number | null;
  value: number | null;
  gain: number | null;
  latest: RatePoint | null;
};

/** One rate a day: the dealer rate where there is one, otherwise the world price converted to rupees. Rupees per tola of pure metal. */
export function rateHistory(rates: MetalRateRow[], metal: Metal): RatePoint[] {
  const byDate = new Map<string, RatePoint>();
  for (const r of rates) {
    if (r.metal !== metal || !(r.pkrPerTola > 0)) continue;
    const have = byDate.get(r.date);
    if (!have || (have.kind === 'international' && r.kind === 'local'))
      byDate.set(r.date, { date: r.date, rate: r.pkrPerTola, kind: r.kind });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function metalReport(
  assets: Asset[],
  metal: Metal,
  rates: MetalRateRow[],
  asOf: string,
): MetalReport {
  const mine = assets.filter(
    (a): a is MetalAsset => a.kind === 'metal' && a.metal === metal,
  );
  const buys = mine.flatMap((a) =>
    a.entries
      .filter((e) => !e.voided && e.type === 'buy' && e.amount !== null)
      .map((e) => ({ date: e.date, amount: e.amount!, key: a.id })),
  );
  const history = rateHistory(rates, metal);
  const valued = mine.map((a) => valueMetal(a, rates, asOf));
  const pure = mine.reduce(
    (t, a) =>
      t + metalPosition(a).grams * (metal === 'gold' ? purity(a.karat) : 1),
    0,
  );
  const costs = valued.map((v) => v.cost);
  const cost = costs.some((c) => c === null)
    ? null
    : cents(costs.reduce<number>((t, c) => t + (c ?? 0), 0));
  const values = valued.map((v) => v.value);
  const value = values.some((v) => v === null)
    ? null
    : cents(values.reduce<number>((t, v) => t + (v ?? 0), 0));
  return {
    metal,
    monthly: monthly(buys, asOf),
    history,
    grams: valued.reduce((t, v) => t + v.grams, 0),
    averageCostPerTola:
      cost === null || pure <= 0 ? null : (cost / pure) * TOLA_GRAMS,
    cost,
    value,
    gain: value === null || cost === null ? null : cents(value - cost),
    latest: history.at(-1) ?? null,
  };
}
