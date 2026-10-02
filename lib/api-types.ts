// Request/response shapes of the JSON API, shared by the web app and the native
// apps. Types only (no runtime imports), so the mobile bundle can use this file
// directly. Routes use `satisfies` against these so the two cannot drift.
// Not yet covered: market-summary and research/* (added with the screens that use them).
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { Portfolio, Quote } from './portfolio.ts';
import type { PricePoint } from './price-history.ts';
import type { MonthlyPicksResearch } from './monthly-picks.ts';
import type { ProgressStepKey } from './monthly-picks-progress.ts';
export type { DataMeta, Freshness } from './market-meta.ts';

// Mirrors lib/roles.ts (which imports the Workers runtime, so it can't be shared).
export type Role = 'super_admin' | 'user';

export type ApiError = { error: string };

export type MeResponse = {
  email: string;
  name: string | null;
  picture: string | null;
  role: Role;
};

/** DELETE /api/me body: the signed-in email, typed by the user, confirms the permanent deletion. */
export type DeleteAccountRequest = { confirm: string };
export type DeleteAccountResponse = { deleted: true };

export type MobileSignInRequest = {
  /** Google ID token from the native Google Sign-In SDK. */
  idToken: string;
  deviceName?: string;
  platform?: 'ios' | 'android';
};
export type MobileSignInResponse = {
  /** Send as `Authorization: Bearer <token>` on every API request. */
  token: string;
  user: MeResponse;
};

export type MobileSessionInfo = {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
};
export type MobileSessionsResponse = { sessions: MobileSessionInfo[] };

export type PortfolioResponse = {
  portfolio: Portfolio;
  revision: number;
  announcements: PayoutAnnouncement[];
};
/** PUT /api/portfolio body. A stale `revision` is answered with 409. */
export type SavePortfolioRequest = { portfolio: Portfolio; revision: number };
export type SavePortfolioResponse = { revision: number };

/** POST /api/quotes body: `{ tickers }` (optionally `?force=1`). */
export type QuotesResponse = {
  quotes: Record<string, Quote>;
  errors: string[];
  reasons: Record<string, string>;
  stale: Record<string, string>;
};

export type UsageResponse = { inputTokens: number; outputTokens: number; costUsd: number };

export type PriceHistoryResponse = {
  ticker: string;
  eod: PricePoint[];
  intraday: PricePoint[];
  eodFetchedAt: string | null;
  intradayFetchedAt: string | null;
};
export type PriceHistoryBatchResponse = {
  histories: Record<string, { eod: PricePoint[] }>;
};

// ---- Monthly Picks (GET/POST /api/recommendations) -------------------------------------------

export type RecommendationStatus =
  | 'queued' | 'gathering' | 'in_progress' | 'completed' | 'failed'
  // Only on rows saved by earlier workflows; shown read-only.
  | 'completed_partial' | 'needs_evidence' | 'needs_attention';

/** Persisted run progress. `percent` is a phase milestone plus real company counts, never elapsed time. */
export type RecommendationProgress = {
  /** Legacy fields older clients read. */
  phase?: 'gathering' | 'ranking';
  pending: string[];
  startedAt?: string;
  /** Additive, written by the run processor. */
  step?: ProgressStepKey;
  completed?: number;
  total?: number;
  retries?: number;
  degraded?: boolean;
  message?: string | null;
  updatedAt?: string;
  percent?: number;
  /** True while waiting on the AI provider (no measurable fraction). */
  indeterminate?: boolean;
};

export type RecommendationRun = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  status: RecommendationStatus;
  result: MonthlyPicksResearch | null;
  error: string | null;
  model: string;
  estimatedCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
  workflowVersion?: number;
  method?: 'ai' | 'quant';
  dataAsOf?: string;
  progress?: RecommendationProgress;
};
export type FactsInfo = { ticker: string; state: 'fresh' | 'stale' | 'missing' | 'failed'; fetchedOn: string | null; ageDays: number | null; error: string | null };
export type RecommendationListResponse = {
  recommendations: RecommendationRun[];
  facts: FactsInfo[];
  dispatchEnabled: boolean;
  factsMaxAgeDays: number;
  backgroundProcessing: boolean;
};
/** POST /api/recommendations body. `idempotencyKey` makes a repeated request return the same run. */
export type StartRecommendationRequest = {
  month: string; amount: number; feePct: number; shortlist: string[]; rerun?: boolean; idempotencyKey?: string;
};

/** GET /api/admin/health (super admin only). */
export type PicksHealthResponse = {
  now: string; activeRuns: number; oldestActiveRunAgeSec: number | null; stuckRuns: number;
  failedLast24h: number; completedLast24h: number; lastCompletedAt: string | null;
  lastFactsFetchedAt: string | null; lastQuoteFetchedAt: string | null; quoteLagMinutes: number | null;
  recentFactsErrors: { ticker: string; error: string; attemptedAt: string | null }[];
  providerRequests24h: number; warnings: string[]; backgroundProcessing: boolean;
};
