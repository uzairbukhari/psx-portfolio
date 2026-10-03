// Parses the public PSX company page (https://dps.psx.com.pk/company/<TICKER>) into
// structured facts: price, valuation stats, four years of annual + quarterly financials,
// margin/growth ratios, and dated announcements. This is the same page
// `lib/psx-quotes.ts` already fetches for a live quote; here we also read the
// financial tables it ignores, so Monthly Picks can score companies from data PSX
// already publishes instead of asking an AI model to search the web for it.
import { quoteDate } from './psx-quotes.ts';
import { fetchPsx } from './psx-fetch.ts';
import { constrainAllocations } from './allocation.ts';

export type FinancialPeriod = { period: string; revenue: number | null; pat: number | null; eps: number | null };
export type Announcement = { date: string; title: string; category: 'Financial Results' | 'Board Meetings' | 'Others'; url: string | null };
export type CompanyFacts = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  priceDate: string;
  peTtm: number | null;
  week52: { low: number | null; high: number | null };
  change1y: number | null;
  changeYtd: number | null;
  marketCapThousands: number | null;
  freeFloatPct: number | null;
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
  ratios: { grossMargin: (number | null)[]; netMargin: (number | null)[]; epsGrowth: (number | null)[]; peg: (number | null)[] };
  announcements: Announcement[];
  source: string;
  fetchedAt: string;
};

function stripTags(s: string) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  let text = stripTags(raw).replace(/[%]/g, '').trim();
  if (!text || /^n\/?a$/i.test(text) || text === '-' || text === '—') return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  const value = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
function stat(html: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`stats_label">${escaped}[\\s\\S]*?<\\/div><div class="stats_value[^"]*">(?:<i[^>]*><\\/i>)?\\s*([-\\d,.]+)`));
  return match ? parseNumber(match[1]) : null;
}
function allStats(html: string, label: string): number[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`stats_label">${escaped}<\\/div><div class="stats_value[^"]*">(?:<i[^>]*><\\/i>)?\\s*([-\\d,.%]+)`, 'g');
  return [...html.matchAll(re)].map((m) => parseNumber(m[1])).filter((v): v is number => v !== null);
}
// Top-level page sections are marked `<div class="section ..." id="...">`; cutting at
// the next such marker (rather than any nested `id="..."`) keeps a section's own
// sub-tabs (e.g. `id="financialTab"` inside `id="financials"`) from being lost.
function section(html: string, id: string): string {
  const marker = new RegExp(`<div class="section[^"]*"\\s+id="${id}"`);
  const match = marker.exec(html);
  if (!match) return '';
  const next = html.indexOf('<div class="section', match.index + match[0].length);
  return html.slice(match.index, next === -1 ? undefined : next);
}
function panel(html: string, name: string): string {
  // A tab name also appears as a `tabs__list__item` label before the matching
  // `tabs__panel` — search for the panel opening tag specifically, not any occurrence.
  const start = html.indexOf(`<div class="tabs__panel" data-name="${name}"`);
  if (start === -1) return '';
  const next = html.indexOf('<div class="tabs__panel"', start + 20);
  return html.slice(start, next === -1 ? undefined : next);
}
function parseTable(block: string): { periods: string[]; rows: Map<string, (number | null)[]> } {
  const headMatch = block.match(/<thead[^>]*>([\s\S]*?)(?:<\/thead>|<tbody)/);
  const headerRow = headMatch ? headMatch[1] : '';
  const periods = [...headerRow.matchAll(/<th[^>]*>([^<]*)<\/th>/g)]
    .map((m) => stripTags(m[1]))
    .filter((text) => text.length > 0);
  const bodyMatch = block.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  const rows = new Map<string, (number | null)[]>();
  if (bodyMatch) {
    for (const rowMatch of bodyMatch[1].matchAll(/<tr>\s*<td>([^<]*)<\/td>([\s\S]*?)<\/tr>/g)) {
      const label = stripTags(rowMatch[1]);
      const cells = [...rowMatch[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => parseNumber(c[1]));
      rows.set(label, cells);
    }
  }
  return { periods, rows };
}
function financialPeriods(block: string, revenueLabels: string[]): FinancialPeriod[] {
  const { periods, rows } = parseTable(block);
  const revenueRow = revenueLabels.map((label) => rows.get(label)).find((row) => row);
  const patRow = rows.get('Profit after Taxation');
  const epsRow = rows.get('EPS');
  return periods.map((period, index) => ({
    period,
    revenue: revenueRow?.[index] ?? null,
    pat: patRow?.[index] ?? null,
    eps: epsRow?.[index] ?? null,
  }));
}
function ratiosBlock(html: string): CompanyFacts['ratios'] {
  const { rows } = parseTable(section(html, 'ratios'));
  const row = (label: string) => rows.get(label) ?? [];
  return {
    grossMargin: row('Gross Profit Margin (%)'),
    netMargin: row('Net Profit Margin (%)'),
    epsGrowth: row('EPS Growth (%)'),
    peg: row('PEG'),
  };
}
function announcementRows(block: string, category: Announcement['category']): Announcement[] {
  const bodyMatch = block.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];
  const out: Announcement[] = [];
  for (const rowMatch of bodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 2) continue;
    const date = stripTags(cells[0]);
    const title = stripTags(cells[1]);
    const pdf = cells[2]?.match(/href="([^"]+\.pdf)"/i)?.[1] ?? null;
    if (!date || !title) continue;
    out.push({ date, title, category, url: pdf ? new URL(pdf, 'https://dps.psx.com.pk').toString() : null });
  }
  return out;
}

export function parseCompanyPage(html: string, ticker: string, fetchedAt = new Date().toISOString()): CompanyFacts {
  const source = `https://dps.psx.com.pk/company/${ticker}`;
  const quoteBlock = section(html, 'quote');
  const nameMatch = quoteBlock.match(/quote__name">([^<]*)/);
  const sectorMatch = quoteBlock.match(/quote__sector"><span>([^<]*)/);
  const priceMatch = html.match(/quote__close["'][^>]*>Rs\.\s*([0-9,.]+)/i);
  const asOfMatch = html.match(/quote__date["'][^>]*>\^ As of ([^<]+)/i);
  const price = parseNumber(priceMatch?.[1]);
  if (!price || price <= 0 || !asOfMatch) throw Error(`Unexpected PSX company markup for ${ticker} (${html.length} bytes)`);
  const priceDate = quoteDate(asOfMatch[1].trim());

  const rangeMatch = html.match(/52-WEEK RANGE[\s\S]*?data-low="([^"]+)" data-high="([^"]+)"/);
  const freeFloatPercents = allStats(html, 'Free Float').filter((v) => v <= 100);
  const financialsSection = section(html, 'financials');

  return {
    ticker,
    name: nameMatch ? stripTags(nameMatch[1]) : ticker,
    sector: sectorMatch ? stripTags(sectorMatch[1]) : 'Unknown',
    price,
    priceDate,
    peTtm: stat(html, 'P/E Ratio (TTM)'),
    week52: { low: rangeMatch ? parseNumber(rangeMatch[1]) : null, high: rangeMatch ? parseNumber(rangeMatch[2]) : null },
    change1y: stat(html, '1-Year Change'),
    changeYtd: stat(html, 'YTD Change'),
    marketCapThousands: stat(html, "Market Cap"),
    freeFloatPct: freeFloatPercents.length ? freeFloatPercents[freeFloatPercents.length - 1] : null,
    annual: financialPeriods(panel(financialsSection, 'Annual'), ['Sales', 'Mark-up Earned']),
    quarterly: financialPeriods(panel(financialsSection, 'Quarterly'), ['Sales', 'Mark-up Earned']),
    ratios: ratiosBlock(html),
    announcements: (() => {
      const announcementsSection = section(html, 'announcements');
      return [
        ...announcementRows(panel(announcementsSection, 'Financial Results'), 'Financial Results'),
        ...announcementRows(panel(announcementsSection, 'Board Meetings'), 'Board Meetings'),
        ...announcementRows(panel(announcementsSection, 'Others'), 'Others'),
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
    })(),
    source,
    fetchedAt,
  };
}

/**
 * Scraped facts are at most a day or more old, but the shared `quote_refreshes`
 * cache is refreshed every few minutes. When it holds a newer price, use it and
 * rescale P/E (price / EPS) so valuation stays consistent with the price.
 */
export function overlayQuote(
  facts: CompanyFacts,
  quote: { price: number; quoteDate: string; fetchedAt: string } | undefined,
): CompanyFacts {
  if (!quote || !(quote.price > 0) || !(facts.price > 0)) return facts;
  if (quote.quoteDate < facts.priceDate || quote.fetchedAt <= facts.fetchedAt) return facts;
  return {
    ...facts,
    price: quote.price,
    priceDate: quote.quoteDate,
    peTtm: facts.peTtm === null ? null : round2(facts.peTtm * (quote.price / facts.price)),
  };
}

export async function fetchCompanyFacts(ticker: string): Promise<CompanyFacts> {
  const response = await fetchPsx(`https://dps.psx.com.pk/company/${ticker}`);
  return parseCompanyPage(await response.text(), ticker);
}

// ---------------------------------------------------------------------------
// Deterministic metrics and scoring — turns raw PSX facts into a comparable,
// explainable 0-100 score per company with zero AI involvement. This is both
// the input the AI ranking step reasons over and the fallback result used
// whenever that AI step is unavailable, so a run always produces a result.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function announcementIsoDate(text: string): string | null {
  const match = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(\d{4})\b/);
  if (!match) return null;
  return `${match[3]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

export type CompanyMetrics = {
  ticker: string;
  name: string;
  unavailable?: string;
  peTtm: number | null;
  earningsYieldPct: number | null;
  epsTtm: number | null;
  epsYoYPct: number | null;
  epsAnnualCagrPct: number | null;
  netMarginTrendPct: number | null;
  pricePositionPct: number | null;
  change1yPct: number | null;
  mostRecentAnnouncement: (Announcement & { ageDays: number }) | null;
  recentAnnouncements: Announcement[];
  dataGaps: string[];
};

/** `Q3 2026` -> running quarter index. Null when a period repeats; labels that are not discrete quarters are ignored. */
function quarterSeries(periods: FinancialPeriod[]): Map<number, number | null> | null {
  const out = new Map<number, number | null>();
  for (const p of periods) {
    const match = p.period.match(/^Q([1-4])\s+(\d{4})$/);
    if (!match) continue;
    const index = Number(match[2]) * 4 + Number(match[1]) - 1;
    if (out.has(index)) return null;
    out.set(index, p.eps);
  }
  return out.size ? out : null;
}
/** Sum of the latest four consecutive quarters; any missing quarter makes it unavailable. */
function trailingEps(series: Map<number, number | null>): number | null {
  const latest = Math.max(...series.keys());
  let total = 0;
  for (let back = 0; back < 4; back++) {
    const eps = series.get(latest - back);
    if (eps === null || eps === undefined || !Number.isFinite(eps)) return null;
    total += eps;
  }
  return round2(total);
}
function yearOverYear(series: Map<number, number | null>): number | null {
  const latest = Math.max(...series.keys());
  const now = series.get(latest);
  const prior = series.get(latest - 4);
  if (now === null || now === undefined || prior === null || prior === undefined) return null;
  if (!Number.isFinite(now) || !Number.isFinite(prior) || prior === 0) return null;
  return round2(((now - prior) / Math.abs(prior)) * 100);
}
/** Compound growth between the oldest and latest reported fiscal years, over the years actually elapsed. */
function annualCagr(periods: FinancialPeriod[]): number | null {
  const byYear = new Map<number, number>();
  for (const p of periods) {
    if (!/^\d{4}$/.test(p.period) || p.eps === null || !Number.isFinite(p.eps)) continue;
    const year = Number(p.period);
    if (byYear.has(year)) return null;
    byYear.set(year, p.eps);
  }
  if (byYear.size < 2) return null;
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const first = byYear.get(years[0])!;
  const last = byYear.get(years.at(-1)!)!;
  const elapsed = years.at(-1)! - years[0];
  if (!(first > 0) || !(last > 0) || elapsed < 1) return null;
  return round2((Math.pow(last / first, 1 / elapsed) - 1) * 100);
}

export function computeMetrics(facts: CompanyFacts | { ticker: string; unavailable: string }, asOf: string): CompanyMetrics {
  if ('unavailable' in facts) {
    return {
      ticker: facts.ticker, name: facts.ticker, unavailable: facts.unavailable,
      peTtm: null, earningsYieldPct: null, epsTtm: null, epsYoYPct: null, epsAnnualCagrPct: null,
      netMarginTrendPct: null, pricePositionPct: null, change1yPct: null,
      mostRecentAnnouncement: null, recentAnnouncements: [],
      dataGaps: [`PSX data unavailable: ${facts.unavailable}`],
    };
  }
  const gaps: string[] = [];
  const peTtm = facts.peTtm;
  if (peTtm === null) gaps.push('No P/E (TTM) published.');
  const earningsYieldPct = peTtm && peTtm > 0 ? round2(100 / peTtm) : null;

  const quarterly = quarterSeries(facts.quarterly);
  const epsTtm = quarterly ? trailingEps(quarterly) : null;
  if (epsTtm === null) gaps.push('No four consecutive quarters of EPS.');

  const epsYoYPct = quarterly ? yearOverYear(quarterly) : null;
  if (epsYoYPct === null) gaps.push('No matching year-ago quarter EPS for growth comparison.');

  const epsAnnualCagrPct = annualCagr(facts.annual);

  const netMargins = facts.ratios.netMargin.filter((v): v is number => v !== null);
  const netMarginTrendPct = netMargins.length >= 2 ? round2(netMargins[0] - netMargins.at(-1)!) : null;

  const pricePositionPct = facts.week52.low !== null && facts.week52.high !== null && facts.week52.high > facts.week52.low
    ? round2(((facts.price - facts.week52.low) / (facts.week52.high - facts.week52.low)) * 100)
    : null;

  const dated = facts.announcements
    .map((a) => ({ ...a, iso: announcementIsoDate(a.date) }))
    .filter((a): a is Announcement & { iso: string } => a.iso !== null)
    .sort((a, b) => (a.iso < b.iso ? 1 : -1));
  const mostRecent = dated[0];
  const mostRecentAnnouncement = mostRecent
    ? { ...mostRecent, ageDays: Math.round((Date.parse(asOf) - Date.parse(mostRecent.iso)) / 86_400_000) }
    : null;
  if (!mostRecentAnnouncement) gaps.push('No dated announcements found.');

  return {
    ticker: facts.ticker, name: facts.name,
    peTtm, earningsYieldPct, epsTtm, epsYoYPct, epsAnnualCagrPct, netMarginTrendPct, pricePositionPct,
    change1yPct: facts.change1y,
    mostRecentAnnouncement,
    recentAnnouncements: dated.slice(0, 3),
    dataGaps: gaps,
  };
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type ScoreEvidence = {
  /** Share of the four scored metrics (valuation, growth, profitability, momentum) that were available. */
  completeness: number;
  metricCount: number;
  missing: string[];
};
export type CompanyScore = {
  ticker: string;
  /** 0-100 attractiveness among the shortlist, over available metrics only. */
  score: number;
  /** Attractiveness and evidence quality together; a high score on thin evidence is never High. */
  confidence: 'High' | 'Medium' | 'Low';
  components: { valuation: number | null; growth: number | null; profitability: number | null; momentum: number | null; catalyst: number | null };
  evidence: ScoreEvidence;
  metrics: CompanyMetrics;
};

/** Minimum scored metrics for a company to be selectable. */
export const MIN_EVIDENCE_METRICS = 2;

/** Average (mid) percentile ranks: ties share a rank, missing values stay null. */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values.flatMap((v, i) => (v !== null && Number.isFinite(v) ? [{ v, i }] : []));
  if (present.length === 0) return values.map(() => null);
  if (present.length === 1) return values.map((_, i) => (i === present[0].i ? 50 : null));
  const sorted = [...present].sort((a, b) => a.v - b.v);
  const rank = new Map<number, number>();
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].v === sorted[start].v) end++;
    const mid = (start + end) / 2;
    for (let k = start; k <= end; k++) rank.set(sorted[k].i, (mid / (sorted.length - 1)) * 100);
    start = end + 1;
  }
  return values.map((_, i) => rank.get(i) ?? null);
}

const WEIGHTS = { valuation: 0.35, growth: 0.35, profitability: 0.15, momentum: 0.15 } as const;
const SCORED = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];

export function quantScore(metricsList: CompanyMetrics[]): CompanyScore[] {
  const only = (pick: (m: CompanyMetrics) => number | null) => metricsList.map((m) => (m.unavailable ? null : pick(m)));
  const valuation = percentileRanks(only((m) => m.earningsYieldPct));
  const growth = percentileRanks(only((m) => m.epsYoYPct ?? m.epsAnnualCagrPct));
  const profitability = percentileRanks(only((m) => m.netMarginTrendPct));
  const momentum = percentileRanks(only((m) => m.change1yPct));
  // Announcement recency is context only: it is shown but never scored as a positive catalyst.
  const catalyst = percentileRanks(only((m) => (m.mostRecentAnnouncement ? -m.mostRecentAnnouncement.ageDays : null)));
  return metricsList.map((metrics, i) => {
    const components = { valuation: valuation[i], growth: growth[i], profitability: profitability[i], momentum: momentum[i], catalyst: catalyst[i] };
    if (metrics.unavailable) {
      return { ticker: metrics.ticker, score: 0, confidence: 'Low' as const, components, evidence: { completeness: 0, metricCount: 0, missing: [...SCORED] }, metrics };
    }
    const present = SCORED.filter((key) => components[key] !== null);
    const missing = SCORED.filter((key) => components[key] === null);
    const weight = present.reduce((sum, key) => sum + WEIGHTS[key], 0);
    const score = weight > 0 ? round2(present.reduce((sum, key) => sum + components[key]! * WEIGHTS[key], 0) / weight) : 0;
    const completeness = round2(present.length / SCORED.length);
    const confidence: CompanyScore['confidence'] =
      score >= 72 && completeness >= 0.75 ? 'High' : score >= 60 && completeness >= 0.5 ? 'Medium' : 'Low';
    return { ticker: metrics.ticker, score, confidence, components, evidence: { completeness, metricCount: present.length, missing }, metrics };
  });
}

export type QuantPick = { ticker: string; allocationPct: number; score: number };
export function quantAllocation(scores: CompanyScore[], threshold = 55, maxPicks = 5, capPct = 35): { picks: QuantPick[]; unallocatedPct: number } {
  const candidates = scores.filter((s) => !s.metrics.unavailable && s.evidence.metricCount >= MIN_EVIDENCE_METRICS && s.score >= threshold)
    .sort((a, b) => b.score - a.score).slice(0, maxPicks);
  if (!candidates.length) return { picks: [], unallocatedPct: 100 };
  // Same constraint set as the AI path (`constrainAllocations`): proportional to score, capped
  // at `capPct` with the excess re-split, and whatever cannot be placed left as cash.
  const constrained = constrainAllocations(candidates.map((c) => ({ ticker: c.ticker, weight: c.score })), 0, capPct);
  const scoreOf = new Map(candidates.map((c) => [c.ticker, c.score]));
  const picks = constrained.allocations.map((a) => ({ ticker: a.ticker, score: scoreOf.get(a.ticker)!, allocationPct: a.allocationPct }));
  return { picks, unallocatedPct: constrained.cashPct };
}

/** A scraped company page, or the reason there is none. */
export type FactsResult = CompanyFacts | { ticker: string; unavailable: string };
