import {
  holdings,
  round,
  type Portfolio,
  type ResearchPolicy,
  type Screening,
} from './portfolio.ts';

export type CompanyAssessment = {
  ticker: string;
  eligible: boolean;
  exclusionReasons: string[];
  researchVersionReviewed: number | null;
  stance: 'Consider' | 'Watchlist' | 'Avoid' | 'Research incomplete' | 'None';
  criticalConditions: string[];
  screening: Screening | null;
  effectiveQuote: { price: number; date: string } | null;
  valuation: {
    low: number | null;
    base: number | null;
    high: number | null;
    provenance: 'scenario-model' | 'legacy' | 'unavailable';
  };
  approvedMaxPrice: number | null;
  currentExposurePct: number;
  targetExposurePct: number;
  companyHeadroomPct: number;
  sectorHeadroomPct: number | null;
};

function effectiveQuoteFor(
  p: Portfolio,
  ticker: string,
  policy: ResearchPolicy,
  today: string,
): { price: number; date: string } | null {
  const q = p.quotes[ticker];
  if (!q) return null;
  if (policy.quoteFreshness === 'today')
    return q.date === today ? { price: q.price, date: q.date } : null;
  const maxAge = policy.maxQuoteAgeDays ?? 0;
  const ageDays = (Date.parse(today) - Date.parse(q.date)) / 86400000;
  return ageDays >= 0 && ageDays <= maxAge
    ? { price: q.price, date: q.date }
    : null;
}

function sectorExposurePct(
  p: Portfolio,
  sector: string,
  totalValue: number,
): number {
  if (!sector || !totalValue) return 0;
  const value = holdings(p)
    .filter((h) => h.sector === sector)
    .reduce((a, h) => a + (h.value ?? 0), 0);
  return (value / totalValue) * 100;
}

function sectorHasUnpricedHolding(p: Portfolio, sector: string): boolean {
  if (!sector) return false;
  return holdings(p).some(
    (h) => h.sector === sector && h.shares > 0 && h.value === null,
  );
}

export function assessCompany(
  p: Portfolio,
  policy: ResearchPolicy,
  ticker: string,
  today: string,
): CompanyAssessment {
  const c = p.companies.find((x) => x.ticker === ticker);
  if (!c) throw Error(ticker + ': not found in companies.');
  const research = p.research?.find((r) => r.ticker === ticker);
  const stance: CompanyAssessment['stance'] = research
    ? (research.stance ?? 'Research incomplete')
    : 'None';
  const hs = holdings(p);
  const totalValue = hs.reduce((a, h) => a + (h.value ?? 0), 0);
  const holding = hs.find((h) => h.ticker === ticker);
  const currentExposurePct = totalValue
    ? ((holding?.value ?? 0) / totalValue) * 100
    : 0;
  const targetExposurePct = c.target;
  const targetHeadroomPct = round(targetExposurePct - currentExposurePct);
  const companyHeadroomPct = round(policy.companyCapPct - currentExposurePct);
  const sectorUnpriced = c.sector ? sectorHasUnpricedHolding(p, c.sector) : false;
  const sectorHeadroomPctRaw =
    !c.sector || sectorUnpriced
      ? null
      : policy.sectorCapPct - sectorExposurePct(p, c.sector, totalValue);
  const sectorHeadroomPct =
    sectorHeadroomPctRaw === null ? null : round(sectorHeadroomPctRaw);
  const effectiveQuote = effectiveQuoteFor(p, ticker, policy, today);
  const screening = c.screening ?? null;
  const criticalConditions: string[] = [];
  if (
    c.approvedResearchVersion != null &&
    research &&
    c.approvedResearchVersion !== (research.researchRevision ?? 0)
  )
    criticalConditions.push(
      `Research updated since approval (approved revision ${c.approvedResearchVersion}, current revision ${research.researchRevision ?? 0}) — re-review required.`,
    );
  const approvedMaxPrice = c.approvedMaxPrice ?? null;
  const valuation: CompanyAssessment['valuation'] = {
    low: research?.fairValueLow ?? null,
    base: research?.fairValue ?? null,
    high: research?.fairValueHigh ?? null,
    provenance:
      research?.valuationProvenance ??
      (research?.fairValue != null ? 'legacy' : 'unavailable'),
  };
  const reasons: string[] = [];
  if (!c.approved) reasons.push('Not approved for contributions.');
  if (c.target <= 0) reasons.push('No positive target set.');
  if (stance !== 'Consider')
    reasons.push(`Research stance is "${stance}", not Consider.`);
  for (const cond of criticalConditions) reasons.push('Unresolved: ' + cond);
  if (!screening) reasons.push('No recorded Shariah screening evidence.');
  else if (screening.status === 'Fail')
    reasons.push('Failed Shariah screening.');
  else if (screening.status === 'Pending')
    reasons.push('Shariah screening is pending, not yet passed.');
  else if (!screening.reviewDueDate)
    reasons.push('No screening review due date set.');
  else if (screening.reviewDueDate < today)
    reasons.push('Shariah screening review is overdue.');
  if (!effectiveQuote)
    reasons.push('No accepted quote under the current policy.');
  if (approvedMaxPrice == null)
    reasons.push('No approved maximum purchase price set.');
  else if (effectiveQuote && effectiveQuote.price > approvedMaxPrice)
    reasons.push(
      `Quote price ${effectiveQuote.price} exceeds the approved maximum of ${approvedMaxPrice}.`,
    );
  if (targetHeadroomPct <= 0)
    reasons.push('Already at or above target weight; no gap to fill.');
  if (companyHeadroomPct <= 0)
    reasons.push('Already at or above the company allocation limit.');
  if (!c.sector)
    reasons.push('Sector not classified; allocation blocked until classified.');
  else if (sectorUnpriced)
    reasons.push(
      'Sector exposure cannot be confirmed: a holding in this sector has no current price.',
    );
  else if (sectorHeadroomPct !== null && sectorHeadroomPct <= 0)
    reasons.push('Sector already at or above the sector allocation limit.');
  return {
    ticker,
    eligible: reasons.length === 0,
    exclusionReasons: reasons,
    researchVersionReviewed: c.approvedResearchVersion ?? null,
    stance,
    criticalConditions,
    screening,
    effectiveQuote,
    valuation,
    approvedMaxPrice,
    currentExposurePct: round(currentExposurePct),
    targetExposurePct,
    companyHeadroomPct,
    sectorHeadroomPct,
  };
}

export function assessAll(
  p: Portfolio,
  policy: ResearchPolicy,
  today: string,
): CompanyAssessment[] {
  return p.companies.map((c) => assessCompany(p, policy, c.ticker, today));
}
