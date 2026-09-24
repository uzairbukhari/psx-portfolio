import { dateOK, round, today, type Portfolio } from './portfolio.ts';

export type MonthlyPick = {
  ticker: string;
  name: string;
  allocationPct: number;
  confidence: 'High' | 'Medium' | 'Low';
  thesis: string;
  catalysts: string[];
  risks: string[];
  sourceUrls: string[];
};

export type CompanyOutlook = {
  ticker: string;
  outlook: 'Positive' | 'Neutral' | 'Negative' | 'Insufficient evidence';
  summary: string;
  sourceUrls: string[];
};

export type MonthlyPicksResearch = {
  marketOutlook: string;
  picks: MonthlyPick[];
  coverage: CompanyOutlook[];
  unallocatedPct: number;
};

export type MonthlyPickEstimate = MonthlyPick & {
  allocationPkr: number;
  price: number | null;
  priceDate: string | null;
  shares: number | null;
  estimatedSpend: number | null;
  cashRemaining: number | null;
};

const ageDays = (date: string) =>
  Math.floor((Date.parse(today()) - Date.parse(date)) / 86_400_000);

export function estimateMonthlyPicks(
  result: MonthlyPicksResearch,
  portfolio: Portfolio,
  amount: number,
  feePct: number,
): MonthlyPickEstimate[] {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9)
    throw Error('Investment amount must be between PKR 0 and PKR 1 billion.');
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 10)
    throw Error('Fee estimate must be between 0% and 10%.');
  return result.picks.map((pick) => {
    const allocationPkr = round((amount * pick.allocationPct) / 100);
    const quote = portfolio.quotes[pick.ticker];
    const fresh = quote && dateOK(quote.date) && ageDays(quote.date) <= 7;
    if (!fresh)
      return {
        ...pick,
        allocationPkr,
        price: null,
        priceDate: quote?.date ?? null,
        shares: null,
        estimatedSpend: null,
        cashRemaining: null,
      };
    const unitCost = Math.ceil(quote.price * (1 + feePct / 100) * 100) / 100;
    const shares = Math.floor(allocationPkr / unitCost);
    const estimatedSpend = round(shares * unitCost);
    return {
      ...pick,
      allocationPkr,
      price: quote.price,
      priceDate: quote.date,
      shares,
      estimatedSpend,
      cashRemaining: round(allocationPkr - estimatedSpend),
    };
  });
}

export function validateMonthlyPicksResearch(
  value: unknown,
  shortlist: string[],
  allowedSources: Set<string>,
): MonthlyPicksResearch {
  const result = value as MonthlyPicksResearch;
  const canonicalTickers = new Map(shortlist.map((ticker) => [ticker.toUpperCase(), ticker]));
  if (!result || typeof result.marketOutlook !== 'string')
    throw Error('The research response is incomplete.');
  if (!Array.isArray(result.picks) || result.picks.length > 5)
    throw Error('The recommendation must contain no more than five picks.');
  if (!Array.isArray(result.coverage) || result.coverage.length !== shortlist.length)
    throw Error('The research must cover every shortlisted company.');
  let unallocatedPct = Number(result.unallocatedPct);
  if (!Number.isFinite(unallocatedPct) || unallocatedPct < 0 || unallocatedPct > 100)
    throw Error('Invalid unallocated percentage.');
  const covered = new Set<string>();
  const coverageSources = new Map<string, string[]>();
  for (const item of result.coverage) {
    const ticker =
      typeof item.ticker === 'string'
        ? canonicalTickers.get(item.ticker.trim().toUpperCase())
        : undefined;
    if (
      !ticker ||
      covered.has(ticker) ||
      !['Positive', 'Neutral', 'Negative', 'Insufficient evidence'].includes(item.outlook) ||
      typeof item.summary !== 'string'
    )
      throw Error('The recommendation contains invalid company coverage.');
    const sourceUrls = validatedSources(item.sourceUrls, allowedSources);
    item.ticker = ticker;
    if (sourceUrls) {
      item.sourceUrls = sourceUrls;
      coverageSources.set(ticker, sourceUrls);
    } else {
      item.outlook = 'Insufficient evidence';
      item.summary = 'No verified source was returned, so this company is not eligible for a recommendation.';
      item.sourceUrls = [];
    }
    covered.add(ticker);
  }
  const pickTickers = new Set<string>();
  const verifiedPicks: MonthlyPick[] = [];
  for (const pick of result.picks) {
    const ticker =
      typeof pick.ticker === 'string'
        ? canonicalTickers.get(pick.ticker.trim().toUpperCase())
        : undefined;
    if (!ticker) throw Error('The recommendation contains a company outside the shortlist.');
    if (pickTickers.has(ticker)) throw Error(`The recommendation repeats ${ticker}.`);
    if (!Number.isFinite(pick.allocationPct) || pick.allocationPct <= 0 || pick.allocationPct > 100)
      throw Error(`The recommendation contains an invalid allocation for ${ticker}.`);
    if (
      !['High', 'Medium', 'Low'].includes(pick.confidence) ||
      typeof pick.thesis !== 'string' ||
      !Array.isArray(pick.catalysts) ||
      !Array.isArray(pick.risks)
    )
      throw Error(`The recommendation contains incomplete analysis for ${ticker}.`);
    const sourceUrls =
      validatedSources(pick.sourceUrls, allowedSources) ?? coverageSources.get(ticker);
    pick.ticker = ticker;
    pickTickers.add(ticker);
    if (sourceUrls) {
      pick.sourceUrls = sourceUrls;
      verifiedPicks.push(pick);
    } else {
      unallocatedPct += pick.allocationPct;
    }
  }
  result.picks = verifiedPicks;
  result.unallocatedPct = unallocatedPct;
  const total = unallocatedPct + verifiedPicks.reduce((sum, pick) => sum + pick.allocationPct, 0);
  if (Math.abs(total - 100) > 0.01)
    throw Error('Recommended allocations and cash must total 100%.');
  return result;
}

function validatedSources(urls: unknown, allowed: Set<string>) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const allowedByKey = new Map<string, string>();
  for (const url of allowed) {
    const key = sourceKey(url);
    if (key) allowedByKey.set(key, url);
  }
  const matched = urls.map((url) =>
    typeof url === 'string' ? allowedByKey.get(sourceKey(url) ?? '') : undefined,
  );
  return matched.every((url): url is string => Boolean(url)) ? [...new Set(matched)] : null;
}

function sourceKey(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    const trackingKeys = Array.from(url.searchParams.keys()).filter((key) =>
      /^(utm_|fbclid$|gclid$)/i.test(key),
    );
    for (const key of trackingKeys) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}
