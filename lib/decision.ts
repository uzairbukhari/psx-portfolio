import {
  holdings,
  round,
  confirmedFunds,
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
  // A company with research that has never had a version explicitly
  // approved is its own exclusion reason (pushed into `reasons` below),
  // not a critical condition — silence here would let a company qualify
  // without the approval step ever having happened.
  const researchNeverApproved = !!research && c.approvedResearchVersion == null;
  if (
    c.approvedResearchVersion != null &&
    research &&
    c.approvedResearchVersion !== (research.researchRevision ?? 0)
  )
    criticalConditions.push(
      `Research updated since approval (approved revision ${c.approvedResearchVersion}, current revision ${research.researchRevision ?? 0}) — re-review required.`,
    );
  if (research && research.status !== 'Complete')
    criticalConditions.push(
      `Research status is "${research.status}", not Complete.`,
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
  if (researchNeverApproved)
    reasons.push(
      'Current research version has not been approved for contributions.',
    );
  for (const cond of criticalConditions) reasons.push('Unresolved: ' + cond);
  if (!screening) reasons.push('No recorded Shariah screening evidence.');
  else if (!screening.source.trim())
    reasons.push('No Shariah screening source recorded.');
  else if (screening.status === 'Fail')
    reasons.push('Failed Shariah screening.');
  else if (screening.status === 'Pending')
    reasons.push('Shariah screening is pending, not yet passed.');
  else if (!screening.effectiveDate)
    reasons.push('No screening effective date recorded.');
  else if (screening.effectiveDate > today)
    reasons.push('Screening is not yet in effect.');
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

export type ResearchPlanRow = {
  ticker: string;
  name: string;
  price: number | null;
  asOf: string;
  currentWeight: number;
  target: number;
  eligible: boolean;
  exclusionReasons: string[];
  gap: number;
  shares: number;
  amount: number;
};

export type ResearchPlanResult = {
  budget: number;
  already: number;
  remaining: number;
  confirmedFunds: number;
  availableToSpend: number;
  total: number;
  invested: number;
  leftover: number;
  errors: string[];
  stale: string[];
  rows: ResearchPlanRow[];
};

export function researchPlan(
  p: Portfolio,
  policy: ResearchPolicy,
  month: string,
  feePct: number,
  todayDate: string,
): ResearchPlanResult {
  const hs = holdings(p);
  const budget = p.budgets[month] ?? 100000;
  const already = round(
    p.trades
      .filter((t) => !t.voided && t.kind === 'buy' && t.month === month)
      .reduce((a, t) => a + t.shares * t.price! + t.fees, 0),
  );
  const remaining = Math.max(0, round(budget - already));
  const funds = confirmedFunds(p, month);
  const remainingFunds = Math.max(0, round(funds - already));
  const availableToSpend = Math.min(remaining, remainingFunds);

  const candidates = hs.filter((h) => h.target > 0);
  const totalTarget = candidates.reduce((a, h) => a + h.target, 0);
  const errors: string[] = [];
  if (Math.abs(totalTarget - 100) > 0.01)
    errors.push('Target weights must total 100%.');
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 10)
    errors.push('Fee estimate must be between 0% and 10%.');

  const total = hs.reduce((a, h) => a + (h.value ?? 0), 0);
  const post = total + availableToSpend;

  const assessments = new Map(
    assessAll(p, policy, todayDate).map((a) => [a.ticker, a]),
  );

  const sectorTotals = new Map<string, number>();
  for (const h of hs)
    if (h.sector)
      sectorTotals.set(
        h.sector,
        (sectorTotals.get(h.sector) ?? 0) + (h.value ?? 0),
      );

  const stale = candidates
    .filter((h) => h.quote && h.quote.date !== todayDate)
    .map((h) => h.ticker);

  // Per-company cap, tracked separately from the row's reported `gap` — the
  // reported `gap` bakes in a one-time snapshot of sector headroom (useful as
  // a display value), but the ALLOCATION ceiling below must re-check sector
  // headroom live as sibling companies in the same sector consume it, in both
  // the proportional first pass and the greedy second pass. Using the static
  // per-row `gap` as the allocation ceiling in the first pass would let every
  // company in a sector independently claim up to the full sector cap,
  // multiplying it by however many companies share that sector.
  const companyGaps = new Map<string, number>();
  const sectorCap = (policy.sectorCapPct / 100) * post;

  const rows: ResearchPlanRow[] = candidates.map((h) => {
    const a = assessments.get(h.ticker)!;
    const companyCap = (Math.min(h.target, policy.companyCapPct) / 100) * post;
    const companyGap = Math.max(0, companyCap - (h.value ?? 0));
    companyGaps.set(h.ticker, companyGap);
    const sectorRemaining = h.sector
      ? Math.max(0, sectorCap - (sectorTotals.get(h.sector) ?? 0))
      : 0;
    const gap = a.eligible ? Math.min(companyGap, sectorRemaining) : 0;
    return {
      ticker: h.ticker,
      name: h.name,
      price: a.effectiveQuote?.price ?? null,
      asOf: h.quote?.asOf ?? '',
      currentWeight: total ? ((h.value ?? 0) / total) * 100 : 0,
      target: h.target,
      eligible: a.eligible,
      exclusionReasons: a.exclusionReasons,
      gap,
      shares: 0,
      amount: 0,
    };
  });

  if (!errors.length && availableToSpend > 0) {
    let cash = availableToSpend;
    const active = rows.filter((r) => r.eligible && r.gap > 0);
    const gapsTotal = active.reduce((a, r) => a + r.gap, 0);
    for (const r of active) {
      const h = hs.find((x) => x.ticker === r.ticker)!;
      const price = r.price!;
      const unit = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
      const companyGap = companyGaps.get(r.ticker)!;
      const sectorRemainingLive = h.sector
        ? Math.max(0, sectorCap - (sectorTotals.get(h.sector) ?? 0))
        : Infinity;
      const ceiling = Math.min(companyGap, sectorRemainingLive);
      const proportional = gapsTotal
        ? (availableToSpend * r.gap) / gapsTotal
        : 0;
      const allocation = Math.min(ceiling, proportional);
      r.shares = Math.floor(allocation / unit);
      r.amount = round(r.shares * unit);
      cash = round(cash - r.amount);
      if (h.sector)
        sectorTotals.set(
          h.sector,
          (sectorTotals.get(h.sector) ?? 0) + r.amount,
        );
    }
    for (let i = 0; i < 10000; i++) {
      const next = active
        .filter((r) => {
          const price = r.price!;
          const u = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
          const companyGap = companyGaps.get(r.ticker)!;
          if (u > cash || r.amount + u > companyGap) return false;
          const h = hs.find((x) => x.ticker === r.ticker)!;
          if (h.sector) {
            const sectorUsed = sectorTotals.get(h.sector) ?? 0;
            if (sectorUsed + u > sectorCap) return false;
          }
          return true;
        })
        .sort((a, b) => b.gap - b.amount - (a.gap - a.amount))[0];
      if (!next) break;
      const h = hs.find((x) => x.ticker === next.ticker)!;
      const price = next.price!;
      const unit = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
      next.shares++;
      next.amount = round(next.amount + unit);
      cash = round(cash - unit);
      if (h.sector)
        sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + unit);
    }
  }

  const invested = round(rows.reduce((a, r) => a + r.amount, 0));
  return {
    budget,
    already,
    remaining,
    confirmedFunds: funds,
    availableToSpend,
    total,
    invested,
    leftover: round(availableToSpend - invested),
    errors,
    stale,
    rows,
  };
}
