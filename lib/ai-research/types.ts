// Shapes shared by the AI research job (GitHub Actions), the Worker routes that read its output and the AI Lab UI.
// Everything here is public market analysis keyed by ticker. Nothing refers to an account, holding or amount.

export type Provider = 'openai' | 'anthropic';
export type ModelRole = 'read' | 'rank';

/** Why a stored report is (or is not) being reused. */
export type ReuseDecision = 'full' | 'update' | 'carry' | 'fresh';

export type FactValue = { label: string; value: number | string | null };
/** Deterministic, dated facts for one ticker; every fact has a stable key the report can cite. */
export type FactPack = {
  ticker: string;
  name: string;
  sector: string;
  asOf: string;
  price: number | null;
  priceDate: string | null;
  facts: Record<string, FactValue>;
  /** Recent PSX announcements (title only; the job treats them as untrusted text). */
  announcements: { date: string; title: string; category: string; url: string | null }[];
  /** URL of the newest financial-results PDF announced on PSX, when there is one. */
  latestFilingUrl: string | null;
};

export type ReportCatalyst = { date: string; text: string; sourceUrl: string };
export type ReportEvidence = { claim: string; factKey: string; sourceUrl: string; quote: string; verified?: boolean };
export type ThesisState = 'intact' | 'weakened' | 'broken' | 'unknown';
export type RedFlag = { text: string; sourceUrl: string; quote: string; verified?: boolean };
/** Public judgement of the company as an investment; the device combines it with the user's own position. */
export type HoldingView = {
  thesisState: ThesisState;
  redFlags: RedFlag[];
  stretchedValuation: boolean;
  whatWouldMakeItASell: string;
};
export type CompanyReport = {
  thesis: string;
  businessSummary: string;
  earningsQuality: string;
  valuationView: string;
  dividendOutlook: string;
  catalysts: ReportCatalyst[];
  risks: string[];
  bullCase: string;
  bearCase: string;
  bearReviewNote?: string;
  expectedReturn: { lowPct: number; basePct: number; highPct: number; horizonDays: number };
  /** 0-100. The ranking and every device rule use this, never the prose. */
  conviction: number;
  evidence: ReportEvidence[];
  dataGaps: string[];
  holdingView: HoldingView;
};

export type StoredReport = {
  ticker: string;
  report: CompanyReport;
  inputsHash: string;
  priceAtReport: number | null;
  researchedAt: string;
  /** Last time the job confirmed nothing relevant changed; the device uses this for freshness. */
  checkedAt: string;
  carriedForward: boolean;
  model: string;
  verification: VerificationStats;
};
export type VerificationStats = { claims: number; verified: number; dropped: number; convictionPenalty: number };

export type MacroBrief = {
  month: string;
  summary: string;
  policyRate: string;
  inflation: string;
  currency: string;
  fiscalAndImf: string;
  sectorViews: { sector: string; view: 'positive' | 'neutral' | 'negative'; reason: string }[];
  sources: { url: string; title: string }[];
};

export type RankingEntry = { ticker: string; rank: number; conviction: number; modelWeightPct: number; note: string };
export type Ranking = {
  month: string;
  tickersHash: string;
  outlook: string;
  entries: RankingEntry[];
  /** Tickers excluded from ranking and why (no research, failed verification, low evidence). */
  excluded: { ticker: string; reason: string }[];
};

export type PublicResearch = {
  reports: StoredReport[];
  ranking: Ranking | null;
  macro: MacroBrief | null;
  requests: { ticker: string; status: RequestStatus; error: string | null; requestedAt: string }[];
  spend: { month: string; usd: number; capUsd: number | null };
  enabled: boolean;
};
export type RequestStatus = 'queued' | 'researching' | 'ready' | 'failed';
