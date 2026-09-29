// Parses the public PSX company page (https://dps.psx.com.pk/company/<TICKER>) into
// structured facts: price, valuation stats, four years of annual + quarterly financials,
// margin/growth ratios, and dated announcements. This is the same page
// `lib/psx-quotes.ts` already fetches for a live quote; here we also read the
// financial tables it ignores, so Monthly Picks can score companies from data PSX
// already publishes instead of asking an AI model to search the web for it.
import { quoteDate } from './psx-quotes.ts';
import { fetchPsx } from './psx-fetch.ts';

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

  const quarters = facts.quarterly.filter((q) => q.eps !== null);
  const epsTtm = quarters.length === 4 ? round2(quarters.reduce((sum, q) => sum + (q.eps ?? 0), 0)) : null;
  if (epsTtm === null) gaps.push('Fewer than four published quarters of EPS.');

  const latestQuarter = facts.quarterly[0];
  const latestLabel = latestQuarter?.period.match(/^(Q\d)\s+(\d{4})$/);
  const priorYearQuarter = latestLabel
    ? facts.quarterly.find((q) => q.period === `${latestLabel[1]} ${Number(latestLabel[2]) - 1}`)
    : undefined;
  const epsYoYPct = latestQuarter?.eps && priorYearQuarter?.eps && priorYearQuarter.eps !== 0
    ? round2(((latestQuarter.eps - priorYearQuarter.eps) / Math.abs(priorYearQuarter.eps)) * 100)
    : null;
  if (epsYoYPct === null) gaps.push('No matching year-ago quarter EPS for growth comparison.');

  const annualEps = facts.annual.filter((a) => a.eps !== null && a.eps! > 0);
  const epsAnnualCagrPct = annualEps.length >= 2 && annualEps.at(-1)!.eps! > 0
    ? round2((Math.pow(annualEps[0].eps! / annualEps.at(-1)!.eps!, 1 / (annualEps.length - 1)) - 1) * 100)
    : null;

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

export type CompanyScore = {
  ticker: string;
  score: number;
  confidence: 'High' | 'Medium' | 'Low';
  components: { valuation: number; growth: number; profitability: number; momentum: number; catalyst: number };
  metrics: CompanyMetrics;
};

function percentileRanks(values: (number | null)[]): number[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
  if (present.length < 2) return values.map(() => 50);
  const sorted = [...present].sort((a, b) => a.v - b.v);
  const rankByIndex = new Map<number, number>();
  sorted.forEach((item, order) => rankByIndex.set(item.i, (order / (sorted.length - 1)) * 100));
  return values.map((_, i) => rankByIndex.get(i) ?? 50);
}

export function quantScore(metricsList: CompanyMetrics[]): CompanyScore[] {
  const valuation = percentileRanks(metricsList.map((m) => m.earningsYieldPct));
  const growth = percentileRanks(metricsList.map((m) => m.epsYoYPct ?? m.epsAnnualCagrPct));
  const profitability = percentileRanks(metricsList.map((m) => m.netMarginTrendPct));
  const momentum = percentileRanks(metricsList.map((m) => m.change1yPct));
  const catalyst = percentileRanks(metricsList.map((m) => (m.mostRecentAnnouncement ? -m.mostRecentAnnouncement.ageDays : null)));
  return metricsList.map((metrics, i) => {
    if (metrics.unavailable) {
      return { ticker: metrics.ticker, score: 0, confidence: 'Low' as const, components: { valuation: 0, growth: 0, profitability: 0, momentum: 0, catalyst: 0 }, metrics };
    }
    const components = { valuation: valuation[i], growth: growth[i], profitability: profitability[i], momentum: momentum[i], catalyst: catalyst[i] };
    const score = round2(components.valuation * 0.30 + components.growth * 0.30 + components.profitability * 0.15 + components.momentum * 0.15 + components.catalyst * 0.10);
    const confidence: CompanyScore['confidence'] = score >= 72 ? 'High' : score >= 60 ? 'Medium' : 'Low';
    return { ticker: metrics.ticker, score, confidence, components, metrics };
  });
}

export type QuantPick = { ticker: string; allocationPct: number; score: number };
export function quantAllocation(scores: CompanyScore[], threshold = 55, maxPicks = 5, capPct = 35): { picks: QuantPick[]; unallocatedPct: number } {
  const candidates = scores.filter((s) => !s.metrics.unavailable && s.score >= threshold)
    .sort((a, b) => b.score - a.score).slice(0, maxPicks);
  if (!candidates.length) return { picks: [], unallocatedPct: 100 };
  // Water-filling: allocate proportional to score, cap any share above `capPct`,
  // and re-split the capped-off amount across the still-uncapped picks. A pick
  // capped with nothing left to redistribute to simply leaves cash unallocated.
  const capped = candidates.map(() => false);
  for (let iteration = 0; iteration <= candidates.length; iteration++) {
    const cappedPct = capped.filter(Boolean).length * capPct;
    const activeTotal = candidates.reduce((sum, c, i) => (capped[i] ? sum : sum + c.score), 0);
    const pct = candidates.map((c, i) => (capped[i] ? capPct : activeTotal > 0 ? (c.score / activeTotal) * (100 - cappedPct) : 0));
    const overIndex = pct.findIndex((p, i) => !capped[i] && p > capPct + 1e-9);
    if (overIndex === -1) {
      const picks = candidates.map((c, i) => ({ ticker: c.ticker, score: c.score, allocationPct: round2(pct[i]) }));
      const unallocatedPct = round2(100 - picks.reduce((sum, p) => sum + p.allocationPct, 0));
      return { picks, unallocatedPct: Math.max(0, unallocatedPct) };
    }
    capped[overIndex] = true;
  }
  const picks = candidates.map((c) => ({ ticker: c.ticker, score: c.score, allocationPct: capPct }));
  return { picks, unallocatedPct: Math.max(0, round2(100 - picks.length * capPct)) };
}
