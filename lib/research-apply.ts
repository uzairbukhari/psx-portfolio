// Applies a completed research job to the portfolio. The server only validates and stores the public dossier on the
// job; the unlocked client merges it into its own (encrypted) portfolio with this function and saves ciphertext.
// Pure, so the same code runs in the browser and in tests.
import { round, today, validate, type Portfolio, type ResearchCompany } from './portfolio.ts';

const textValue = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

export type ResearchJobResult = { id: string; ticker: string; companyName: string };

/** Returns a new portfolio with the dossier saved (and the company added when missing). Throws if the result is malformed. */
export function applyResearchResult(portfolio: Portfolio, job: ResearchJobResult, details: Record<string, unknown>): Portfolio {
  const scores = details.scores as Array<number | null> | undefined;
  const scenarios = details.scenarios as Array<{ eps: number; multiple: number }> | undefined;
  if (!Array.isArray(scores) || !Array.isArray(scenarios) || scenarios.length < 3 || !Array.isArray(details.documents) || !Array.isArray(details.financials))
    throw new Error('The research result is incomplete.');
  const [fairValueLow, fairValue, fairValueHigh] = scenarios.map((s) => round(s.eps * s.multiple));
  const research: ResearchCompany = {
    ticker: job.ticker,
    status: 'Complete',
    score: scores.every((score) => score !== null) ? scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) : null,
    fairValue,
    fairValueLow,
    fairValueHigh,
    thesis: textValue(details.thesis).slice(0, 5000),
    risks: textValue(details.risk).slice(0, 5000),
    catalysts: textValue(details.catalyst).slice(0, 5000),
    conversationUrl: '',
    sources: (details.documents as Array<Record<string, unknown>>).map((document) => textValue(document.url)),
    financials: (details.financials as Array<Record<string, unknown>>).map((item) => ({
      year: textValue(item.year),
      revenue: typeof item.revenue === 'number' ? item.revenue : null,
      profit: typeof item.profit === 'number' ? item.profit : null,
      eps: typeof item.eps === 'number' ? item.eps : null,
      roe: null,
      debt: typeof item.debt === 'number' ? item.debt : null,
    })),
    updatedAt: today(),
    details,
    jobId: job.id,
  };
  const next: Portfolio = JSON.parse(JSON.stringify(portfolio));
  if (!next.companies.some((company) => company.ticker === job.ticker))
    next.companies.push({
      ticker: job.ticker,
      name: job.companyName,
      sector: '',
      target: 0,
      approved: false,
      screenDate: '',
      note: 'Added by automatic company research. Portfolio eligibility remains unset.',
    });
  next.research = [...(next.research ?? []).filter((company) => company.ticker !== job.ticker), research];
  validate(next);
  return next;
}

/** The newest completed job per ticker whose dossier is not in the portfolio yet. */
export function unappliedJobs<T extends { id: string; ticker: string; status: string; completedAt?: string | null; updatedAt: string }>(portfolio: Portfolio, jobs: readonly T[]): T[] {
  const newest = new Map<string, T>();
  for (const job of jobs) {
    if (job.status !== 'complete') continue;
    const seen = newest.get(job.ticker);
    if (!seen || (job.completedAt ?? job.updatedAt) > (seen.completedAt ?? seen.updatedAt)) newest.set(job.ticker, job);
  }
  return [...newest.values()].filter((job) => (portfolio.research ?? []).find((item) => item.ticker === job.ticker)?.jobId !== job.id);
}
