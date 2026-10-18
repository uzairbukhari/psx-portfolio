// Numbers behind the All-portfolios Insights page. Pure: no React, no I/O, no clock (`asOf` is passed in).
//
// Everything is built from the same per-portfolio calculations the rest of the app uses (`consolidatedAccount`,
// `valueAsset`, `accountOverview`), so cost basis is never mixed across portfolios and a figure that cannot be known
// is left out with a reason, never turned into zero. No colours here: the page maps `classKey` onto theme tokens.
import { valueAsset, type Asset } from './assets.ts';
import {
  ASSET_CLASS_LABELS,
  type AccountOverview,
  type AssetClassKey,
} from './account-overview.ts';
import type { FxRateRow } from './fx-rates.ts';
import type { MetalRateRow } from './metal-rates.ts';
import type { FundNavRow } from './mufap.ts';
import type { PlanNavRow } from './plans.ts';
import { moneyInFlows, type CashFlow } from './performance.ts';
import { consolidatedAccount } from './portfolio-account.ts';
import { portfolioReport } from './portfolio-reports.ts';
import { round, type DisplayPart, type Portfolio } from './portfolio.ts';
import type { ReportMode } from './asset-reports.ts';

export type InsightOptions = {
  metalRates?: MetalRateRow[];
  fundNavs?: FundNavRow[];
  planNavs?: PlanNavRow[];
  fxRates?: FxRateRow[];
};

const CLASS_ORDER: AssetClassKey[] = ['stocks', 'funds', 'plans', 'gold', 'silver', 'currency'];

// ───────────────────────── which report set a portfolio gets ─────────────────────────

/** Every report set a portfolio has something for, largest activity first is left to the caller. */
export function reportClasses(p: {
  trades: { voided?: boolean }[];
  dividends?: { voided?: boolean }[];
  assets?: Asset[];
}): ReportMode[] {
  const out: ReportMode[] = [];
  const assets = p.assets ?? [];
  if (p.trades.some((t) => !t.voided) || p.dividends?.some((d) => !d.voided)) out.push('stocks');
  if (assets.some((a) => a.kind === 'fund' || a.kind === 'plan')) out.push('savings');
  if (assets.some((a) => a.kind === 'metal')) out.push('metal');
  if (assets.some((a) => a.kind === 'currency')) out.push('currency');
  return out.length ? out : ['stocks'];
}

// ───────────────────────── allocation tree (treemap) ─────────────────────────

export type InsightNode = {
  name: string;
  value: number;
  classKey: AssetClassKey;
  /** Set on a stock leaf so a click can open the company. */
  ticker?: string;
  children?: InsightNode[];
};

const sectorOfBreakdown = (parts: DisplayPart[]) => {
  const consolidated = consolidatedAccount({
    kind: 'sipwise-portfolio-account',
    version: 1,
    portfolios: parts,
  });
  const sectorOf = new Map<string, string>();
  for (const entry of consolidated.breakdown)
    for (const h of entry.positions)
      if (h.shares > 0 && !sectorOf.has(h.ticker)) sectorOf.set(h.ticker, h.sector || 'Others');
  return { consolidated, sectorOf };
};

/**
 * Class → sector → company for stocks, class → holding for everything else. Only positive, known values appear:
 * a holding with no price yet has no size, so it is counted in `unpriced` instead of drawn as nothing.
 */
export function allocationTree(
  parts: DisplayPart[],
  asOf: string,
  o: InsightOptions = {},
): { root: InsightNode[]; total: number; unpriced: number } {
  const { consolidated, sectorOf } = sectorOfBreakdown(parts);
  let unpriced = 0;
  const root: InsightNode[] = [];

  const sectors = new Map<string, InsightNode[]>();
  for (const h of consolidated.positions) {
    if (h.shares <= 0) continue;
    if (h.value === null || h.value <= 0) {
      unpriced += 1;
      continue;
    }
    const sector = sectorOf.get(h.ticker) ?? 'Others';
    const list = sectors.get(sector) ?? [];
    list.push({ name: h.ticker, value: round(h.value), classKey: 'stocks', ticker: h.ticker });
    sectors.set(sector, list);
  }
  const sectorNodes = [...sectors.entries()]
    .map(([name, children]) => ({
      name,
      classKey: 'stocks' as const,
      value: round(children.reduce((n, c) => n + c.value, 0)),
      children: children.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
  if (sectorNodes.length)
    root.push({
      name: ASSET_CLASS_LABELS.stocks,
      classKey: 'stocks',
      value: round(sectorNodes.reduce((n, s) => n + s.value, 0)),
      children: sectorNodes,
    });

  const byClass = new Map<AssetClassKey, InsightNode[]>();
  for (const part of parts)
    for (const asset of part.portfolio.assets ?? []) {
      const v = valueAsset(
        asset,
        o.metalRates ?? [],
        asOf,
        o.fundNavs ?? [],
        o.planNavs ?? [],
        o.fxRates ?? [],
      );
      if (!v.open && !v.value) continue;
      if (v.value === null) {
        unpriced += 1;
        continue;
      }
      if (v.value <= 0) continue;
      const list = byClass.get(v.classKey) ?? [];
      list.push({ name: asset.name, value: round(v.value), classKey: v.classKey });
      byClass.set(v.classKey, list);
    }
  for (const key of CLASS_ORDER) {
    const children = byClass.get(key);
    if (!children?.length) continue;
    root.push({
      name: ASSET_CLASS_LABELS[key],
      classKey: key,
      value: round(children.reduce((n, c) => n + c.value, 0)),
      children: children.sort((a, b) => b.value - a.value),
    });
  }
  root.sort((a, b) => b.value - a.value);
  return { root, total: round(root.reduce((n, r) => n + r.value, 0)), unpriced };
}

export const treeLeaves = (nodes: InsightNode[]): InsightNode[] =>
  nodes.flatMap((n) => (n.children?.length ? treeLeaves(n.children) : [n]));

// ───────────────────────── concentration ─────────────────────────

export type Concentration = {
  largest: { name: string; share: number } | null;
  topThree: number | null;
  /** 1 / sum of squared weights: how many equal-sized holdings would be as concentrated. */
  effective: number | null;
  count: number;
  level: 'spread' | 'moderate' | 'concentrated' | null;
};

export function concentration(leaves: InsightNode[]): Concentration {
  const total = leaves.reduce((n, l) => n + l.value, 0);
  if (total <= 0 || !leaves.length)
    return { largest: null, topThree: null, effective: null, count: 0, level: null };
  const sorted = leaves
    .map((l) => ({ name: l.name, w: l.value / total }))
    .sort((a, b) => b.w - a.w);
  const hhi = sorted.reduce((n, l) => n + l.w * l.w, 0);
  const topThree = sorted.slice(0, 3).reduce((n, l) => n + l.w, 0) * 100;
  const largest = sorted[0].w * 100;
  return {
    largest: { name: sorted[0].name, share: round(largest) },
    topThree: round(topThree),
    effective: round(1 / hhi),
    count: sorted.length,
    level: largest >= 35 || topThree >= 70 ? 'concentrated' : largest >= 20 || topThree >= 50 ? 'moderate' : 'spread',
  };
}

// ───────────────────────── money in, by class, over time ─────────────────────────

export type ClassSeries = { key: AssetClassKey; label: string; data: number[] };

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + m;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/**
 * Net money paid in, cumulative at each month end, stacked by class. A class that has been paid back more than it took
 * in (profit taking) is held at zero rather than drawn below the axis. Income is not money in and is left out.
 */
export function cumulativeByClass(
  parts: DisplayPart[],
  asOf: string,
  o: InsightOptions = {},
  maxMonths = 120,
): { months: string[]; dates: string[]; series: ClassSeries[] } {
  const flows = new Map<AssetClassKey, CashFlow[]>();
  const add = (key: AssetClassKey, list: CashFlow[]) =>
    flows.set(key, [...(flows.get(key) ?? []), ...list.filter((f) => f.date <= asOf)]);
  for (const part of parts) {
    add('stocks', moneyInFlows(part.portfolio).flows);
    for (const asset of part.portfolio.assets ?? []) {
      const v = valueAsset(
        asset,
        o.metalRates ?? [],
        asOf,
        o.fundNavs ?? [],
        o.planNavs ?? [],
        o.fxRates ?? [],
      );
      add(v.classKey, v.flows);
    }
  }
  const all = [...flows.values()].flat();
  if (!all.length) return { months: [], dates: [], series: [] };
  const first = all.reduce((m, f) => (f.date < m ? f.date : m), all[0].date).slice(0, 7);
  const last = asOf.slice(0, 7);
  let months: string[] = [];
  for (let m = first; m <= last && months.length < 1200; m = nextMonth(m)) months.push(m);
  if (months.length > maxMonths) months = months.slice(months.length - maxMonths);
  const series: ClassSeries[] = [];
  for (const key of CLASS_ORDER) {
    const list = flows.get(key);
    if (!list?.some((f) => f.amount !== 0)) continue;
    const byMonth = new Map<string, number>();
    let before = 0;
    for (const f of list) {
      const m = f.date.slice(0, 7);
      if (m < months[0]) before += f.amount;
      else byMonth.set(m, (byMonth.get(m) ?? 0) + f.amount);
    }
    let run = before;
    const data = months.map((m) => {
      run += byMonth.get(m) ?? 0;
      return Math.max(0, round(run));
    });
    if (data.some((n) => n > 0)) series.push({ key, label: ASSET_CLASS_LABELS[key], data });
  }
  return {
    months,
    dates: months.map((m) => (m === asOf.slice(0, 7) ? asOf : monthEnd(m))),
    series,
  };
}

// ───────────────────────── what built the return (waterfall) ─────────────────────────

export type BridgeStep = {
  label: string;
  value: number;
  kind: 'step' | 'total';
  classKey?: AssetClassKey | 'realized' | 'income';
};
export type ReturnBridge = {
  steps: BridgeStep[];
  total: number;
  /** Classes left out because their gain cannot be known yet (no price or no cost). */
  omitted: string[];
};

/**
 * Gain still sitting in each class, plus stock gains already realised and income already received, adding up to the
 * total return. Classes with an unknown gain are listed in `omitted`, never counted as zero.
 */
export function returnBridge(
  overview: AccountOverview,
  parts: DisplayPart[],
): ReturnBridge {
  const steps: BridgeStep[] = [];
  const omitted: string[] = [];
  for (const c of overview.classes) {
    if (c.gain === null) {
      omitted.push(c.label);
      continue;
    }
    steps.push({ label: c.label, value: round(c.gain), kind: 'step', classKey: c.key });
  }
  const realized = round(
    parts.reduce((n, part) => n + portfolioReport(part.portfolio).realized.totalRealizedGain, 0),
  );
  if (realized !== 0) steps.push({ label: 'Realised', value: realized, kind: 'step', classKey: 'realized' });
  const income = overview.income.receivedTotal;
  if (income !== 0) steps.push({ label: 'Income', value: round(income), kind: 'step', classKey: 'income' });
  const total = round(steps.reduce((n, s) => n + s.value, 0));
  steps.push({ label: 'Total return', value: total, kind: 'total' });
  return { steps, total, omitted };
}

// ───────────────────────── years × months calendar ─────────────────────────

export type MonthCalendar = {
  years: number[];
  /** [year index][month 0..11] */
  income: number[][];
  invested: number[][];
  incomeTotal: number;
  investedTotal: number;
};

/** Income received and money invested per calendar month across the whole history. */
export function monthCalendar(
  parts: DisplayPart[],
  asOf: string,
  o: InsightOptions = {},
): MonthCalendar {
  const consolidated = consolidatedAccount({
    kind: 'sipwise-portfolio-account',
    version: 1,
    portfolios: parts,
  });
  const income = new Map<string, number>();
  const invested = new Map<string, number>();
  const bump = (m: Map<string, number>, date: string, amount: number) =>
    m.set(date.slice(0, 7), (m.get(date.slice(0, 7)) ?? 0) + amount);
  for (const entry of consolidated.breakdown) {
    for (const d of entry.tax.dividends) {
      if (d.status !== 'received' || d.paymentDateUnknown) continue;
      const paid = d.paymentDate ?? d.date;
      if (paid <= asOf) bump(income, paid, d.grossAmount);
    }
    for (const f of moneyInFlows(entry.portfolio).flows)
      if (f.amount > 0 && f.date <= asOf) bump(invested, f.date, f.amount);
  }
  for (const part of parts)
    for (const asset of part.portfolio.assets ?? []) {
      if (asset.kind === 'fund')
        for (const e of asset.entries) {
          if ((e.type === 'dividend' || e.type === 'reinvest') && !e.voided && e.date <= asOf && e.amount)
            bump(income, e.date, e.amount);
        }
      const v = valueAsset(
        asset,
        o.metalRates ?? [],
        asOf,
        o.fundNavs ?? [],
        o.planNavs ?? [],
        o.fxRates ?? [],
      );
      for (const f of v.flows) if (f.amount > 0 && f.date <= asOf) bump(invested, f.date, f.amount);
    }
  const yearsSeen = [...income.keys(), ...invested.keys()].map((m) => Number(m.slice(0, 4)));
  if (!yearsSeen.length)
    return { years: [], income: [], invested: [], incomeTotal: 0, investedTotal: 0 };
  const lo = Math.min(...yearsSeen);
  const hi = Number(asOf.slice(0, 4));
  const years = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const grid = (m: Map<string, number>) =>
    years.map((y) =>
      Array.from({ length: 12 }, (_, i) =>
        round(m.get(`${y}-${String(i + 1).padStart(2, '0')}`) ?? 0),
      ),
    );
  return {
    years,
    income: grid(income),
    invested: grid(invested),
    incomeTotal: round([...income.values()].reduce((n, v) => n + v, 0)),
    investedTotal: round([...invested.values()].reduce((n, v) => n + v, 0)),
  };
}

// ───────────────────────── takeaway headlines ─────────────────────────

const share = (n: number) => `${Math.round(n)}%`;

/** "Stocks are 62% of your net worth" for the biggest class. */
export function allocationTakeaway(root: InsightNode[], total: number): string {
  if (!root.length || total <= 0) return 'Add holdings to see where your money is';
  const top = root[0];
  const lead = `${top.name} ${/s$/.test(top.name) ? 'are' : 'is'} ${share((top.value / total) * 100)} of your net worth`;
  if (top.classKey !== 'stocks' || !top.children?.length || top.value <= 0) return lead;
  const sector = top.children[0];
  return `${lead}, led by ${sector.name} (${share((sector.value / top.value) * 100)} of stocks)`;
}

export function moneyInTakeaway(
  series: ClassSeries[],
  valueNow: number,
  fmt: (n: number) => string,
): string {
  const paid = series.reduce((n, s) => n + (s.data[s.data.length - 1] ?? 0), 0);
  if (paid <= 0) return 'Nothing paid in yet';
  const diff = valueNow - paid;
  return `You have put in ${fmt(paid)}; it is worth ${fmt(valueNow)} today (${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))})`;
}

export function bridgeTakeaway(b: ReturnBridge, fmt: (n: number) => string): string {
  const moves = b.steps.filter((s) => s.kind === 'step');
  if (!moves.length) return 'No return to explain yet';
  const best = moves.reduce((m, s) => (s.value > m.value ? s : m), moves[0]);
  const worst = moves.reduce((m, s) => (s.value < m.value ? s : m), moves[0]);
  const lead = `${best.label} has added the most: ${fmt(best.value)}`;
  return worst.value < 0 ? `${lead}; ${worst.label} is ${fmt(worst.value)}` : lead;
}

export function concentrationTakeaway(c: Concentration): string {
  if (!c.largest || c.effective === null) return 'No priced holdings yet';
  const spread = c.level === 'spread' ? 'well spread' : c.level === 'moderate' ? 'fairly concentrated' : 'highly concentrated';
  return `${c.largest.name} is ${share(c.largest.share)} of your money; you are ${spread}`;
}

export const hasStockActivity = (p: Portfolio) =>
  p.trades.some((t) => !t.voided) || !!p.dividends?.some((d) => !d.voided);
