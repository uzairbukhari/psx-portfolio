import { dateOK, round, today, type Portfolio } from './portfolio.ts';
import { UserError } from './user-error.ts';

export type SourceDetail = { url: string; title: string; date: string; sourceType?: 'primary' | 'secondary' | 'other' };
export type EvidenceIssue = { ticker: string; kind: 'technical' | 'material_gap' | 'uncertainty'; message: string };
export type PickMetrics = {
  peTtm: number | null; earningsYieldPct: number | null; epsYoYPct: number | null;
  change1yPct: number | null; score: number | null;
};
export type MonthlyPick = {
  ticker: string; name: string; allocationPct: number; confidence: 'High' | 'Medium' | 'Low';
  thesis: string; whySelected?: string; invalidation?: string; catalysts: string[]; risks: string[];
  sourceUrls: string[]; sourceDetails?: SourceDetail[]; evidenceStatus?: 'ready' | 'needs_repair';
  metrics?: PickMetrics;
};
export type CompanyOutlook = {
  ticker: string; outlook: 'Positive' | 'Neutral' | 'Negative' | 'Insufficient evidence'; summary: string;
  sourceUrls: string[]; sourceDetails?: SourceDetail[]; assessmentStatus?: 'assessed' | 'unassessed';
  evidenceStatus?: 'ready' | 'needs_repair'; evidenceGap?: string; metrics?: PickMetrics; dataGaps?: string[];
};
export type MonthlyPicksResearch = {
  marketOutlook: string; picks: MonthlyPick[]; coverage: CompanyOutlook[]; unallocatedPct: number;
  evidenceIssues?: EvidenceIssue[]; assessedCount?: number; totalCount?: number;
  method?: 'ai' | 'quant'; dataAsOf?: string;
  /** Why a quant result was used instead of the AI ranking, when that is worth telling the user. */
  fallbackReason?: string;
};
export type MonthlyPickEstimate = MonthlyPick & {
  allocationPkr: number; price: number | null; priceDate: string | null; shares: number | null;
  estimatedSpend: number | null; cashRemaining: number | null;
};
const ageDays = (date: string) => Math.floor((Date.parse(today()) - Date.parse(date)) / 86_400_000);

export function estimateMonthlyPicks(result: MonthlyPicksResearch, portfolio: Portfolio, amount: number, feePct: number): MonthlyPickEstimate[] {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new UserError('Investment amount must be between PKR 0 and PKR 1 billion.');
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 10) throw new UserError('Fee estimate must be between 0% and 10%.');
  return result.picks.map((pick) => {
    const allocationPkr = Math.floor(Math.floor(amount * 100) * pick.allocationPct / 100) / 100;
    const quote = portfolio.quotes[pick.ticker];
    const fresh = quote && Number.isFinite(quote.price) && quote.price > 0 && dateOK(quote.date) && ageDays(quote.date) >= 0 && ageDays(quote.date) <= 7;
    if (!fresh || pick.evidenceStatus === 'needs_repair') return { ...pick, allocationPkr, price: null, priceDate: quote?.date ?? null, shares: null, estimatedSpend: null, cashRemaining: null };
    const unitCost = Math.ceil(quote.price * (1 + feePct / 100) * 100) / 100;
    const shares = Math.floor(allocationPkr / unitCost);
    const estimatedSpend = round(shares * unitCost);
    return { ...pick, allocationPkr, price: quote.price, priceDate: quote.date, shares, estimatedSpend, cashRemaining: round(allocationPkr - estimatedSpend) };
  });
}

export function validateMonthlyPicksResearch(value: unknown, shortlist: string[], allowedSources: Set<string>): MonthlyPicksResearch {
  const result = structuredClone(value) as MonthlyPicksResearch;
  const evidenceIssues: EvidenceIssue[] = [];
  const canonicalTickers = new Map(shortlist.map(ticker => [ticker.toUpperCase(), ticker]));
  if (!result || typeof result.marketOutlook !== 'string') throw new UserError('The research response is incomplete.');
  if (!Array.isArray(result.picks) || result.picks.length > 5) throw new UserError('The recommendation must contain no more than five picks.');
  if (!Array.isArray(result.coverage) || result.coverage.length !== shortlist.length) throw new UserError('The research must cover every shortlisted company.');
  if (!Number.isFinite(result.unallocatedPct) || result.unallocatedPct < 0 || result.unallocatedPct > 100) throw new UserError('Invalid unallocated percentage.');
  const covered = new Set<string>();
  for (const item of result.coverage) {
    const ticker = typeof item?.ticker === 'string' ? canonicalTickers.get(item.ticker.trim().toUpperCase()) : undefined;
    if (!ticker || covered.has(ticker) || !['Positive', 'Neutral', 'Negative', 'Insufficient evidence'].includes(item.outlook) || typeof item.summary !== 'string') throw new UserError('The recommendation contains invalid company coverage.');
    item.ticker = ticker;
    const sourceUrls = validatedSources(item.sourceUrls, allowedSources);
    const assessed = item.assessmentStatus !== 'unassessed' && Boolean(sourceUrls);
    item.sourceUrls = sourceUrls ?? [];
    item.assessmentStatus = assessed ? 'assessed' : 'unassessed';
    item.evidenceStatus = assessed ? 'ready' : 'needs_repair';
    if (!assessed) evidenceIssues.push({ ticker, kind: 'material_gap', message: item.evidenceGap || 'Company-specific evidence is incomplete.' });
    covered.add(ticker);
  }
  const pickTickers = new Set<string>();
  for (const pick of result.picks) {
    const ticker = typeof pick?.ticker === 'string' ? canonicalTickers.get(pick.ticker.trim().toUpperCase()) : undefined;
    if (!ticker) throw new UserError('The recommendation contains a company outside the shortlist.');
    if (pickTickers.has(ticker)) throw new UserError(`The recommendation repeats ${ticker}.`);
    const coverage = result.coverage.find(item => item.ticker === ticker);
    if (!coverage || coverage.assessmentStatus !== 'assessed') throw new UserError(`The recommendation selects unassessed company ${ticker}.`);
    if (!Number.isFinite(pick.allocationPct) || pick.allocationPct <= 0 || pick.allocationPct > 100) throw new UserError(`The recommendation contains an invalid allocation for ${ticker}.`);
    if (!['High', 'Medium', 'Low'].includes(pick.confidence) || typeof pick.thesis !== 'string' || typeof pick.name !== 'string' || !Array.isArray(pick.catalysts) || !Array.isArray(pick.risks) || !pick.catalysts.every(value => typeof value === 'string') || !pick.risks.every(value => typeof value === 'string')) throw new UserError(`The recommendation contains incomplete analysis for ${ticker}.`);
    const sourceUrls = validatedSources(pick.sourceUrls, allowedSources);
    pick.ticker = ticker;
    pickTickers.add(ticker);
    if (!sourceUrls) throw new UserError(`The recommendation selects ${ticker} without company-specific supporting sources.`);
    pick.sourceUrls = sourceUrls;
    pick.evidenceStatus = 'ready';
  }
  const total = result.unallocatedPct + result.picks.reduce((sum, pick) => sum + pick.allocationPct, 0);
  if (Math.abs(total - 100) > 0.01) throw new UserError('Recommended allocations and cash must total 100%.');
  const existing = Array.isArray(result.evidenceIssues) ? result.evidenceIssues.filter(issue => issue && typeof issue === 'object') : [];
  result.evidenceIssues = [...existing, ...evidenceIssues].filter((issue, index, all) => all.findIndex(candidate => candidate.ticker === issue.ticker && candidate.kind === issue.kind) === index);
  if (!result.evidenceIssues.length) delete result.evidenceIssues;
  result.assessedCount = result.coverage.filter(item => item.assessmentStatus === 'assessed').length;
  result.totalCount = shortlist.length;
  return result;
}

function validatedSources(urls: unknown, allowed: Set<string>) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const allowedByKey = new Map<string, string>();
  for (const url of allowed) {
    const key = sourceKey(url);
    if (key) allowedByKey.set(key, url);
  }
  const matched = urls.map(url => typeof url === 'string' ? allowedByKey.get(sourceKey(url) ?? '') : undefined);
  return matched.every((url): url is string => Boolean(url)) ? [...new Set(matched)] : null;
}
function sourceKey(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = ''; url.hostname = url.hostname.toLowerCase();
    for (const key of Array.from(url.searchParams.keys())) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); return url.toString();
  } catch { return null; }
}
