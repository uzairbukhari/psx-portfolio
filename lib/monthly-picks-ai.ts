// Monthly Picks v8: one AI call ranks companies from PSX facts + a deterministic quant
// score that code already computed (see `lib/company-facts.ts`) — it does not search the
// web or prove any number itself, so a citation-validation failure is no longer a failure
// mode. `sanitizePicks` never throws on a model defect (duplicate/unknown ticker, bad
// total, empty output); it returns `null` so the caller falls back to `quantResult`,
// which builds the same shape directly from the quant score with no AI call at all.
import type { CompanyMetrics, CompanyScore } from './company-facts.ts';
import { quantAllocation } from './company-facts.ts';
import type { CompanyOutlook, MonthlyPick, MonthlyPicksResearch, PickMetrics, SourceDetail } from './monthly-picks.ts';

export const WORKFLOW_VERSION = 8;
export const MODEL = 'gpt-5-mini';
export const MAX_OUTPUT_TOKENS = 6000;
// GPT-5 mini: $0.25/M uncached input, $0.025/M cached input, $2/M output. No tools, no
// web search, so the whole run is one small call — a full 400k-context reserve is
// generous headroom, not the actual expected size (~4-8k input tokens for 15 companies).
export const BUDGET_USD = 0.25;
export const PICK_RESERVE = (400_000 * 0.25) / 1e6 + (MAX_OUTPUT_TOKENS * 2) / 1e6;

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

export type ProviderResponse = {
  id?: string; status?: string; output?: unknown[]; error?: { message?: string };
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};
type RecordValue = Record<string, unknown>;
function record(v: unknown): RecordValue {
  return v && typeof v === 'object' ? (v as RecordValue) : {};
}
export function outputText(response: ProviderResponse) {
  return (response.output ?? []).flatMap((o) => (record(o).content as unknown[]) ?? [])
    .filter((v) => record(v).type === 'output_text')
    .map((v) => (typeof record(v).text === 'string' ? String(record(v).text) : ''))
    .join('');
}
export function usage(response: ProviderResponse) {
  const input = response.usage?.input_tokens ?? 0;
  const output = response.usage?.output_tokens ?? 0;
  const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
  return { input, output, cached, cost: ((input - cached) * 0.25 + cached * 0.025 + output * 2) / 1e6 };
}

const object = (properties: RecordValue) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const text = { type: 'string' };
const strings = { type: 'array', items: text };

function availableCompanies(snapshot: SnapshotV8) {
  return snapshot.companies.filter((c) => !c.metrics.unavailable);
}

function companyLine(company: SnapshotCompany, score: CompanyScore | undefined) {
  const m = company.metrics;
  const fmt = (v: number | null, suffix = '') => (v === null ? 'n/a' : `${v}${suffix}`);
  const announcements = m.recentAnnouncements.slice(0, 3)
    .map((a) => `${a.date}: ${a.title.slice(0, 90)} [${a.category}]`).join(' | ') || 'none on file';
  return [
    `${company.ticker} (${company.name}, ${company.sector})`,
    `  quant_score=${score?.score ?? 'n/a'} confidence=${score?.confidence ?? 'n/a'}`,
    `  price=${fmt(company.price)} as_of=${company.priceDate ?? 'n/a'} P/E_TTM=${fmt(m.peTtm)} earnings_yield=${fmt(m.earningsYieldPct, '%')}`,
    `  EPS_TTM=${fmt(m.epsTtm)} EPS_YoY=${fmt(m.epsYoYPct, '%')} EPS_annual_CAGR=${fmt(m.epsAnnualCagrPct, '%')}`,
    `  net_margin_trend=${fmt(m.netMarginTrendPct, 'pp')} 52w_range_position=${fmt(m.pricePositionPct, '%')} 1y_price_change=${fmt(m.change1yPct, '%')}`,
    `  recent_announcements: ${announcements}`,
  ].join('\n');
}

const PICK_INSTRUCTIONS = `You rank Pakistan Stock Exchange companies for the next 60-90 days using only the supplied, code-verified PSX facts and a deterministic quant_score (0-100, already weighted across valuation, growth, profitability trend, price momentum, and catalyst recency) as your baseline. You may rank differently than quant_score, but explain why using the supplied numbers. Never invent a figure not present in the input. Select up to five picks from the listed companies only; fewer or none is valid when nothing stands out. Allocations plus cash (unallocatedPct) must total 100. Cap any single pick at 35%. Cover every listed company in "coverage", including ones you do not pick. Do not promise returns, screen Shariah eligibility, or use any data outside what is supplied.`;

export function pickRequest(snapshot: SnapshotV8) {
  const companies = availableCompanies(snapshot);
  const tickers = companies.map((c) => c.ticker);
  const scoreByTicker = new Map(snapshot.scores.map((s) => [s.ticker, s]));
  const ticker = { type: 'string', enum: tickers.length ? tickers : ['NONE'] };
  const schema = object({
    marketOutlook: text,
    picks: {
      type: 'array', maxItems: 5,
      items: object({
        ticker, allocationPct: { type: 'number' }, confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
        thesis: text, whySelected: text, invalidation: text, catalysts: strings, risks: strings,
      }),
    },
    coverage: {
      type: 'array', minItems: tickers.length, maxItems: tickers.length,
      items: object({ ticker, outlook: { type: 'string', enum: ['Positive', 'Neutral', 'Negative'] }, summary: text }),
    },
    unallocatedPct: { type: 'number' },
  });
  const input = {
    contributionMonth: snapshot.contributionMonth, freshMoneyPkr: snapshot.freshMoneyPkr, dataAsOf: snapshot.dataAsOf,
    companies: companies.map((c) => companyLine(c, scoreByTicker.get(c.ticker))),
  };
  return {
    model: MODEL, background: true, store: true, reasoning: { effort: 'low' }, max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: PICK_INSTRUCTIONS,
    input: JSON.stringify(input),
    text: { format: { type: 'json_schema', name: 'monthly_picks', strict: true, schema } },
  };
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

/** Turns a model response into a validated result, or `null` if nothing usable survived. */
export function sanitizePicks(raw: unknown, snapshot: SnapshotV8): MonthlyPicksResearch | null {
  const parsed = record(raw);
  if (typeof parsed.marketOutlook !== 'string') return null;
  const companyByTicker = new Map(snapshot.companies.map((c) => [c.ticker, c]));
  const scoreByTicker = new Map(snapshot.scores.map((s) => [s.ticker, s]));
  const availableTickers = new Set(availableCompanies(snapshot).map((c) => c.ticker));

  const seenPickTickers = new Set<string>();
  const picks: MonthlyPick[] = [];
  for (const rawPick of Array.isArray(parsed.picks) ? parsed.picks : []) {
    const item = record(rawPick);
    const ticker = typeof item.ticker === 'string' ? item.ticker.toUpperCase() : '';
    if (!availableTickers.has(ticker) || seenPickTickers.has(ticker)) continue;
    if (!Number.isFinite(item.allocationPct) || (item.allocationPct as number) <= 0) continue;
    if (!['High', 'Medium', 'Low'].includes(String(item.confidence))) continue;
    if (typeof item.thesis !== 'string' || !item.thesis.trim()) continue;
    seenPickTickers.add(ticker);
    const { urls, details } = sourcesFor(companyByTicker.get(ticker));
    if (!urls.length) continue;
    picks.push({
      ticker, name: companyByTicker.get(ticker)?.name ?? ticker,
      allocationPct: Math.min(35, Math.max(0.01, Number(item.allocationPct))),
      confidence: item.confidence as MonthlyPick['confidence'], thesis: String(item.thesis),
      whySelected: typeof item.whySelected === 'string' ? item.whySelected : undefined,
      invalidation: typeof item.invalidation === 'string' ? item.invalidation : undefined,
      catalysts: Array.isArray(item.catalysts) ? item.catalysts.filter((v): v is string => typeof v === 'string') : [],
      risks: Array.isArray(item.risks) ? item.risks.filter((v): v is string => typeof v === 'string') : [],
      sourceUrls: urls, sourceDetails: details, evidenceStatus: 'ready',
      metrics: metricsFor(companyByTicker.get(ticker), scoreByTicker.get(ticker)),
    });
  }
  if (!picks.length) return null;

  // Renormalize if the model's allocations plus cash don't sum to 100.
  const pickTotal = picks.reduce((sum, p) => sum + p.allocationPct, 0);
  const rawUnallocated = Number.isFinite(parsed.unallocatedPct) ? Math.max(0, Number(parsed.unallocatedPct)) : 100 - pickTotal;
  const total = pickTotal + rawUnallocated;
  const scale = total > 0 ? 100 / total : 1;
  for (const pick of picks) pick.allocationPct = Math.round(pick.allocationPct * scale * 100) / 100;
  let unallocatedPct = Math.round((100 - picks.reduce((sum, p) => sum + p.allocationPct, 0)) * 100) / 100;
  if (unallocatedPct < 0) { picks[0].allocationPct += unallocatedPct; unallocatedPct = 0; }

  const coverageByTicker = new Map<string, RecordValue>();
  for (const rawItem of Array.isArray(parsed.coverage) ? parsed.coverage : []) {
    const item = record(rawItem);
    const ticker = typeof item.ticker === 'string' ? item.ticker.toUpperCase() : '';
    if (ticker) coverageByTicker.set(ticker, item);
  }
  const coverage: CompanyOutlook[] = snapshot.shortlist.map((ticker) => {
    const company = companyByTicker.get(ticker);
    const metrics = metricsFor(company, scoreByTicker.get(ticker));
    if (!company || company.metrics.unavailable) {
      return {
        ticker, outlook: 'Insufficient evidence', summary: company?.metrics.unavailable ?? 'No PSX data available for this company today.',
        sourceUrls: [], assessmentStatus: 'unassessed', evidenceStatus: 'needs_repair', metrics, dataGaps: company?.metrics.dataGaps,
      };
    }
    const model = coverageByTicker.get(ticker);
    const outlook = model && ['Positive', 'Neutral', 'Negative'].includes(String(model.outlook)) ? String(model.outlook) as CompanyOutlook['outlook'] : 'Neutral';
    const summary = model && typeof model.summary === 'string' && model.summary.trim() ? model.summary : quantSummary(company, scoreByTicker.get(ticker));
    const { urls, details } = sourcesFor(company);
    return { ticker, outlook, summary, sourceUrls: urls, sourceDetails: details, assessmentStatus: 'assessed', evidenceStatus: 'ready', metrics, dataGaps: company.metrics.dataGaps.length ? company.metrics.dataGaps : undefined };
  });

  return {
    marketOutlook: parsed.marketOutlook, picks, coverage, unallocatedPct,
    assessedCount: coverage.filter((c) => c.assessmentStatus === 'assessed').length, totalCount: snapshot.shortlist.length,
    method: 'ai', dataAsOf: snapshot.dataAsOf,
  };
}

function quantSummary(company: SnapshotCompany, score: CompanyScore | undefined): string {
  const m = company.metrics;
  const parts: string[] = [];
  if (m.peTtm !== null) parts.push(`P/E (TTM) ${m.peTtm}`);
  if (m.epsYoYPct !== null) parts.push(`EPS ${m.epsYoYPct >= 0 ? 'up' : 'down'} ${Math.abs(m.epsYoYPct)}% YoY`);
  if (m.change1yPct !== null) parts.push(`price ${m.change1yPct >= 0 ? 'up' : 'down'} ${Math.abs(m.change1yPct)}% over 1 year`);
  return parts.length ? `${parts.join(', ')}. Quant score ${score?.score ?? 'n/a'}/100 (${score?.confidence ?? 'n/a'} confidence).` : `Quant score ${score?.score ?? 'n/a'}/100.`;
}

/** Builds the same result shape directly from the quant score — used whenever the AI step is unavailable. */
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
      risks: ['Automated quantitative ranking — no qualitative or news review was performed for this run.'],
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
    marketOutlook: picks.length
      ? `Quantitative fallback: ranked ${availableCompanies(snapshot).length} of ${snapshot.shortlist.length} shortlisted companies by a deterministic score (valuation, growth, profitability trend, momentum, catalyst recency) from PSX data as of ${snapshot.dataAsOf}. No AI narrative review was completed for this run.`
      : `No shortlisted company scored highly enough on the deterministic quant model (valuation, growth, profitability, momentum, catalyst recency) to recommend an allocation from PSX data as of ${snapshot.dataAsOf}.`,
    picks, coverage, unallocatedPct: allocation.unallocatedPct,
    assessedCount: coverage.filter((c) => c.assessmentStatus === 'assessed').length, totalCount: snapshot.shortlist.length,
    method: 'quant', dataAsOf: snapshot.dataAsOf,
  };
}
