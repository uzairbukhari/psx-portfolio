// Deterministic fact pack for one ticker: PSX company facts, price-history statistics and dividends, each under a
// stable key so a report can cite it and code can later check the cited value. No AI is involved here.
import { computeMetrics, type CompanyFacts } from '../company-facts.ts';
import type { FactPack, FactValue } from './types.ts';

export type DividendRow = { announcedOn: string; bookClosureStart: string; perShareRs: number | null; percent: number | null; kind: string };
/** Daily closes as [unixSeconds, close] pairs, oldest first (the `price_history.eod` shape). */
export type Closes = [number, number][];

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400;

function closeOnOrBefore(closes: Closes, unix: number): number | null {
  for (let i = closes.length - 1; i >= 0; i--) if (closes[i][0] <= unix) return closes[i][1];
  return null;
}

/** Return in % over `days` calendar days ending at the last close; null without enough history. */
export function returnOver(closes: Closes, days: number): number | null {
  if (closes.length < 2) return null;
  const [lastAt, last] = closes[closes.length - 1];
  const first = closes[0];
  if (lastAt - first[0] < days * DAY * 0.9) return null;
  const base = closeOnOrBefore(closes, lastAt - days * DAY);
  return base && base > 0 ? round2(((last - base) / base) * 100) : null;
}

/** Annualised volatility (%) of daily log returns over the last year of closes. */
export function volatilityPct(closes: Closes): number | null {
  const recent = closes.filter(([at]) => at >= closes[closes.length - 1][0] - 365 * DAY);
  if (recent.length < 60) return null;
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) if (recent[i - 1][1] > 0 && recent[i][1] > 0) returns.push(Math.log(recent[i][1] / recent[i - 1][1]));
  if (returns.length < 40) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return round2(Math.sqrt(variance * 250) * 100);
}

/** Largest peak-to-trough fall (%, negative) over the last year of closes. */
export function maxDrawdownPct(closes: Closes): number | null {
  const recent = closes.filter(([at]) => at >= closes[closes.length - 1][0] - 365 * DAY);
  if (recent.length < 60) return null;
  let peak = recent[0][1];
  let worst = 0;
  for (const [, close] of recent) {
    peak = Math.max(peak, close);
    if (peak > 0) worst = Math.min(worst, (close - peak) / peak);
  }
  return round2(worst * 100);
}

/** Cash dividend per share declared in the 12 months before `asOf`, divided by the price. */
export function trailingYieldPct(dividends: DividendRow[], price: number | null, asOf: string): number | null {
  if (!price || price <= 0) return null;
  const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - 365 * DAY * 1000).toISOString().slice(0, 10);
  const total = dividends.filter((d) => d.announcedOn >= from && d.announcedOn <= asOf && d.perShareRs !== null)
    .reduce((sum, d) => sum + (d.perShareRs ?? 0), 0);
  return total > 0 ? round2((total / price) * 100) : 0;
}

export type FactPackInput = {
  facts: CompanyFacts;
  closes: Closes;
  dividends: DividendRow[];
  /** Median P/E (TTM) of other tickers in the same sector that already have stored facts, when 3 or more exist. */
  sectorMedianPe: number | null;
  asOf: string;
};

export function buildFactPack(input: FactPackInput): FactPack {
  const { facts, closes, dividends, sectorMedianPe, asOf } = input;
  const metrics = computeMetrics(facts, asOf);
  const out: Record<string, FactValue> = {};
  const put = (key: string, label: string, value: number | string | null) => { out[key] = { label, value }; };
  put('price', 'Last price (PKR)', facts.price);
  put('peTtm', 'P/E (TTM)', metrics.peTtm);
  put('earningsYieldPct', 'Earnings yield %', metrics.earningsYieldPct);
  put('epsTtm', 'EPS (TTM)', metrics.epsTtm);
  put('epsYoYPct', 'EPS growth YoY %', metrics.epsYoYPct);
  put('epsAnnualCagrPct', 'EPS annual CAGR %', metrics.epsAnnualCagrPct);
  put('netMarginTrendPct', 'Net margin trend (pp)', metrics.netMarginTrendPct);
  put('pricePositionPct', '52-week range position %', metrics.pricePositionPct);
  put('change1yPct', '1-year price change %', metrics.change1yPct);
  put('ret1m', '1-month return %', returnOver(closes, 30));
  put('ret3m', '3-month return %', returnOver(closes, 91));
  put('ret6m', '6-month return %', returnOver(closes, 182));
  put('ret12m', '12-month return %', returnOver(closes, 365));
  put('volatilityPct', 'Annualised volatility %', volatilityPct(closes));
  put('maxDrawdownPct', 'Max drawdown, last year %', maxDrawdownPct(closes));
  put('dividendYieldPct', 'Trailing dividend yield %', trailingYieldPct(dividends, facts.price, asOf));
  put('marketCapMillionPkr', 'Market cap (PKR million)', facts.marketCapThousands === null ? null : round2(facts.marketCapThousands / 1000));
  put('freeFloatPct', 'Free float %', facts.freeFloatPct);
  put('sectorMedianPe', 'Sector median P/E (TTM)', sectorMedianPe);
  facts.annual.slice(0, 4).forEach((p, i) => {
    put(`annual${i}Eps`, `EPS ${p.period}`, p.eps);
    put(`annual${i}Pat`, `Profit after tax ${p.period} (PKR thousand)`, p.pat);
  });
  facts.quarterly.slice(0, 4).forEach((p, i) => {
    put(`quarter${i}Eps`, `EPS ${p.period}`, p.eps);
    put(`quarter${i}Pat`, `Profit after tax ${p.period} (PKR thousand)`, p.pat);
  });
  const filing = facts.announcements.find((a) => a.category === 'Financial Results' && a.url) ?? null;
  return {
    ticker: facts.ticker, name: facts.name, sector: facts.sector, asOf,
    price: facts.price, priceDate: facts.priceDate, facts: out,
    announcements: facts.announcements.slice(0, 10).map((a) => ({ date: a.date, title: a.title, category: a.category, url: a.url })),
    latestFilingUrl: filing?.url ?? null,
  };
}

/** Facts that do not move with the share price, as a stable string: the reuse check hashes this. */
export function stableFactsKey(pack: FactPack): string {
  const stable = Object.entries(pack.facts)
    .filter(([key]) => /^(annual|quarter)\d/.test(key) || key === 'freeFloatPct')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ stable, announcements: pack.announcements.map((a) => [a.date, a.title]) });
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}
