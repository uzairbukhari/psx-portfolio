// Monthly Picks ranking from public PSX facts and the deterministic quant score that code computes
// (`lib/company-facts.ts`). It runs on the user's device (lib/picks-local.ts): no AI provider is involved, so no
// money, holdings or shortlist is ever sent to one. File name kept for history; there is no model call here.
import type { CompanyMetrics, CompanyScore } from './company-facts.ts';
import { quantAllocation } from './company-facts.ts';
import type { CompanyOutlook, MonthlyPick, MonthlyPicksResearch, PickMetrics, SourceDetail } from './monthly-picks.ts';

export const WORKFLOW_VERSION = 10;
/** Bump when scoring, eligibility or sizing rules change; stored with every result. */
export const POLICY_VERSION = 3;
export const MODEL = 'quant-local';

export type SnapshotCompany = {
  ticker: string; name: string; sector: string; source: string | null;
  price: number | null; priceDate: string | null;
  metrics: CompanyMetrics;
};
export type SnapshotV8 = {
  generatedOn: string; contributionMonth: string; freshMoneyPkr: number;
  shortlist: string[]; dataAsOf: string;
  companies: SnapshotCompany[];
  scores: CompanyScore[];
};

function availableCompanies(snapshot: SnapshotV8) {
  return snapshot.companies.filter((c) => !c.metrics.unavailable);
}

function sourcesFor(company: SnapshotCompany | undefined): { urls: string[]; details: SourceDetail[] } {
  if (!company?.source) return { urls: [], details: [] };
  const details: SourceDetail[] = [
    { url: company.source, title: `${company.ticker} PSX company page`, date: company.priceDate ?? company.metrics.mostRecentAnnouncement?.date ?? '', sourceType: 'primary' },
    ...company.metrics.recentAnnouncements.filter((a) => a.url).slice(0, 2)
      .map((a) => ({ url: a.url!, title: a.title, date: a.date, sourceType: 'primary' as const })),
  ];
  return { urls: details.map((d) => d.url), details };
}
function metricsFor(company: SnapshotCompany | undefined, score: CompanyScore | undefined): PickMetrics {
  return {
    peTtm: company?.metrics.peTtm ?? null, earningsYieldPct: company?.metrics.earningsYieldPct ?? null,
    epsYoYPct: company?.metrics.epsYoYPct ?? null, change1yPct: company?.metrics.change1yPct ?? null,
    score: score?.score ?? null,
  };
}

const versionsOf = () => ({ workflow: WORKFLOW_VERSION, policy: POLICY_VERSION, model: MODEL });

function quantSummary(company: SnapshotCompany, score: CompanyScore | undefined): string {
  const m = company.metrics;
  const parts: string[] = [];
  if (m.peTtm !== null) parts.push(`P/E (TTM) ${m.peTtm}`);
  if (m.epsYoYPct !== null) parts.push(`EPS ${m.epsYoYPct >= 0 ? 'up' : 'down'} ${Math.abs(m.epsYoYPct)}% YoY`);
  if (m.change1yPct !== null) parts.push(`price ${m.change1yPct >= 0 ? 'up' : 'down'} ${Math.abs(m.change1yPct)}% over 1 year`);
  return parts.length ? `${parts.join(', ')}. Quant score ${score?.score ?? 'n/a'}/100 (${score?.confidence ?? 'n/a'} confidence).` : `Quant score ${score?.score ?? 'n/a'}/100.`;
}

/** Builds the result directly from the quant score. */
export function quantResult(snapshot: SnapshotV8): MonthlyPicksResearch {
  const companyByTicker = new Map(snapshot.companies.map((c) => [c.ticker, c]));
  const scoreByTicker = new Map(snapshot.scores.map((s) => [s.ticker, s]));
  const allocation = quantAllocation(snapshot.scores);
  const picks: MonthlyPick[] = allocation.picks.map((p) => {
    const company = companyByTicker.get(p.ticker)!;
    const score = scoreByTicker.get(p.ticker);
    const { urls, details } = sourcesFor(company);
    return {
      ticker: p.ticker, name: company.name, allocationPct: p.allocationPct,
      confidence: score?.confidence ?? 'Low',
      thesis: quantSummary(company, score),
      whySelected: `Ranked ${allocation.picks.findIndex((x) => x.ticker === p.ticker) + 1} of ${allocation.picks.length} by quantitative score among the shortlist.`,
      invalidation: 'A published result or price move that reverses the valuation, growth, or momentum figures above.',
      catalysts: company.metrics.mostRecentAnnouncement ? [`${company.metrics.mostRecentAnnouncement.date}: ${company.metrics.mostRecentAnnouncement.title.slice(0, 100)}`] : [],
      risks: ['Automated quantitative ranking — no qualitative or news review is performed.'],
      sourceUrls: urls, sourceDetails: details, evidenceStatus: 'ready',
      metrics: metricsFor(company, score),
    };
  });
  const coverage: CompanyOutlook[] = snapshot.shortlist.map((ticker) => {
    const company = companyByTicker.get(ticker);
    const score = scoreByTicker.get(ticker);
    const metrics = metricsFor(company, score);
    if (!company || company.metrics.unavailable) {
      return { ticker, outlook: 'Insufficient evidence', summary: company?.metrics.unavailable ?? 'No PSX data available for this company today.', sourceUrls: [], assessmentStatus: 'unassessed', evidenceStatus: 'needs_repair', metrics, dataGaps: company?.metrics.dataGaps };
    }
    const { urls, details } = sourcesFor(company);
    const outlook: CompanyOutlook['outlook'] = (score?.score ?? 0) >= 60 ? 'Positive' : (score?.score ?? 0) >= 40 ? 'Neutral' : 'Negative';
    return { ticker, outlook, summary: quantSummary(company, score), sourceUrls: urls, sourceDetails: details, assessmentStatus: 'assessed', evidenceStatus: 'ready', metrics, dataGaps: company.metrics.dataGaps.length ? company.metrics.dataGaps : undefined };
  });
  return {
    marketOutlook: (picks.length
      ? `Quantitative ranking: ${availableCompanies(snapshot).length} of ${snapshot.shortlist.length} shortlisted companies ranked by a deterministic score (valuation, growth, profitability trend, momentum, catalyst recency) from PSX data as of ${snapshot.dataAsOf}, calculated on this device. No AI narrative review is performed, so nothing about your money or holdings is sent to an AI provider.`
      : `No shortlisted company scored highly enough on the deterministic quant model (valuation, growth, profitability, momentum, catalyst recency) to recommend an allocation from PSX data as of ${snapshot.dataAsOf}.`),
    picks, coverage, unallocatedPct: allocation.unallocatedPct,
    assessedCount: coverage.filter((c) => c.assessmentStatus === 'assessed').length, totalCount: snapshot.shortlist.length,
    method: 'quant', dataAsOf: snapshot.dataAsOf, versions: versionsOf(),
  };
}
