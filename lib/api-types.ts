// Request/response shapes of the JSON API, shared by the web app and the native
// apps. Types only (no runtime imports), so the mobile bundle can use this file
// directly. Routes use `satisfies` against these so the two cannot drift.
// Not yet covered: market-summary and research/* (added with the screens that use them).
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { FaceValueEvidence } from './face-values.ts';
import type { Portfolio, Quote } from './portfolio.ts';
import type { PricePoint } from './price-history.ts';
import type { IpoLookup } from './ipo-offers.ts';
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
  /** Companies whose name or sector the shared directory has not resolved yet (additive; old clients ignore it). */
  pendingCompanies?: string[];
  /** Verified, dated face-value evidence for the held companies (additive). Empty = none verified. */
  faceValues?: Record<string, FaceValueEvidence[]>;
};
/**
 * PUT /api/portfolio body. A stale `revision` is answered with 409. `createCompanies` is the strict
 * Add Company intent: those tickers must be new to the portfolio and fully resolved in the shared company
 * directory, and their name and sector are taken from it. Omitted (imports, old clients), the save is tolerant:
 * unresolved metadata is kept as entered and repaired by a later save.
 */
export type SavePortfolioRequest = { portfolio: Portfolio; revision: number; createCompanies?: string[] };
export type SavePortfolioResponse = {
  revision: number;
  /** Name and sector the server filled in from the company directory (additive; old clients ignore it). */
  details?: { ticker: string; name: string; sector: string }[];
  /** Companies the directory could not resolve yet; a lookup is queued and a later save repairs them. */
  pendingCompanies?: string[];
};

/** POST /api/quotes body: `{ tickers }` (optionally `?force=1`). */
export type QuotesResponse = {
  quotes: Record<string, Quote>;
  errors: string[];
  reasons: Record<string, string>;
  stale: Record<string, string>;
  /** Additive: per-ticker provider, source/fetch times, session and session-aware freshness. */
  meta?: Record<string, import('./market-meta.ts').DataMeta>;
  /** Additive: the manual-refresh job (state, verified per-ticker outcomes, the one user-facing message). */
  job?: import('./quote-job-types.ts').QuoteJob;
};

export type UsageResponse = { inputTokens: number; outputTokens: number; costUsd: number };

export type PriceHistoryResponse = {
  ticker: string;
  eod: PricePoint[];
  intraday: PricePoint[];
  eodFetchedAt: string | null;
  intradayFetchedAt: string | null;
  /** Additive: freshness of the daily and intraday series, judged by their last point, not by fetch time. */
  eodMeta?: import('./market-meta.ts').DataMeta;
  intradayMeta?: import('./market-meta.ts').DataMeta;
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
  providerRequests24h: number; marketOpen: boolean; unsettledFactsRequests: number;
  warnings: string[]; backgroundProcessing: boolean;
};

/** One of the four supported indices in GET /api/market-summary `summary.indices`. */
export type MarketIndexView = {
  code: 'KSE100' | 'KSE30' | 'KMI30' | 'ALLSHR';
  label: string;
  name: string;
  close: number;
  change: number;
  changePercent: number;
  previousClose: number;
  asOf: string;
  date: string;
  high: number;
  low: number;
  ytdChangePercent: number;
  retrievedAt: string;
  /** Sampled intraday points (one per scrape); empty when none yet. */
  series: { time: number; value: number }[];
  seriesKind: 'sampled';
  meta: import('./market-meta.ts').DataMeta;
};

/** `summary.breadth` in GET /api/market-summary. Counts securities in the source table, not listed companies. */
export type MarketBreadthView = {
  advances: number; declines: number; unchanged: number; volume: number;
  covered: number; sourceRows: number; excluded: number; volumeMissing: number;
  source: string; asOf: string | null; retrievedAt: string | null;
};

/** Where a per-company on-demand fetch (historical dividend announcements, IPO evidence) stands. */
export type RefreshTickerState = {
  ticker: string;
  state: 'none' | 'queued' | 'running' | 'completed' | 'failed';
  requestedAt?: string;
  completedAt?: string;
  /** Rows the last successful fetch returned; 0 is a successful empty result, not a failure. */
  rowsFound?: number | null;
  /** Earliest announcement date the source returned; earlier history is not covered. */
  coverageFrom?: string | null;
  error?: string | null;
  attempts?: number;
};
export type RefreshOverall = 'idle' | 'queued' | 'running' | 'completed' | 'partial' | 'failed';

/** GET/POST /api/dividends/refresh?tickers=: historical announcement fetch status for the tickers the client names. */
export type DividendRefreshResponse = {
  /** The tickers the client asked about (the server never derives them from a portfolio). */
  tickers: string[];
  states: RefreshTickerState[];
  overall: RefreshOverall;
  announcements: PayoutAnnouncement[];
  dispatchEnabled: boolean;
  disabledReason: string | null;
  /** POST only: what this call did. */
  queued?: string[];
  alreadyRunning?: string[];
  message?: string;
};

/** GET/POST /api/ipo-offers: official offer evidence for symbols that need an assumed acquisition. */
export type IpoOffersResponse = {
  lookups: IpoLookup[];
  states: RefreshTickerState[];
  overall: RefreshOverall;
  dispatchEnabled: boolean;
  disabledReason: string | null;
  queued?: string[];
  message?: string;
};

/** What the shared company directory knows about one symbol. */
export type CompanyLookup = {
  ticker: string;
  /** `resolved`: name and sector are verified; `pending`: a lookup is under way; `unresolved`: no usable evidence yet. */
  state: 'resolved' | 'pending' | 'unresolved';
  company: {
    name: string;
    sector: string;
    sectorCode: string | null;
    securityType: 'equity' | 'etf' | 'debt' | null;
    listingStatus: 'listed' | 'delisted' | null;
    /** Verified current face value (Rs), or null when none is on file. */
    faceValue: number | null;
  } | null;
  source: 'directory' | 'facts' | null;
  /** Safe, user-facing explanation (never a provider error). */
  message: string | null;
  /** True when POST /api/companies can start a lookup for this symbol. */
  canRequest: boolean;
};
/** GET /api/companies?tickers=A,B (cached, read-only) and POST /api/companies (queues missing lookups). */
export type CompaniesResponse = {
  companies: CompanyLookup[];
  dispatchEnabled: boolean;
  /** POST only. */
  queued?: string[];
  message?: string;
};

/** GET/POST /api/face-values: verified face-value evidence for the signed-in ledger's companies. */
export type FaceValuesResponse = {
  tickers: string[];
  evidence: Record<string, FaceValueEvidence[]>;
  states: RefreshTickerState[];
  overall: RefreshOverall;
  dispatchEnabled: boolean;
  disabledReason: string | null;
  queued?: string[];
  message?: string;
};

// ---- Private vault (client-side encrypted portfolio) -----------------------------------------------
// The server stores ciphertext only. Types come from the shared crypto module (types only, no runtime).
import type { PasswordWrapper, PortfolioEnvelope, RecoveryWrapper, VaultKeyMaterial } from './vault-crypto.ts';
export type { PasswordWrapper, PortfolioEnvelope, RecoveryWrapper, VaultKeyMaterial };

/** GET /api/vault: `vault` is null until the person sets one up. Authentication alone never opens a vault. */
export type VaultResponse = { vault: (VaultKeyMaterial & { createdAt: string }) | null };
/** POST /api/vault: creates the vault and its encrypted blank portfolio (revision 1) atomically. */
export type VaultSetupRequest = { material: VaultKeyMaterial; envelope: PortfolioEnvelope };
export type VaultSetupResponse = { vault: VaultKeyMaterial & { createdAt: string }; revision: 1 };
/** PUT /api/vault: conditional wrapper replacement (password change, recovery-key replacement). */
export type VaultWrappersRequest = { expectedWrapperVersion: number; password?: PasswordWrapper; recovery?: RecoveryWrapper };
export type VaultWrappersResponse = { wrapperVersion: number };
/** DELETE /api/vault: permanently erases the vault and its ciphertext. Needed only when both secrets are lost. */
export type VaultDeleteRequest = { confirm: true };

/** GET /api/v2/portfolio */
export type EncryptedPortfolioResponse = { vaultId: string; revision: number; envelope: PortfolioEnvelope; updatedAt: string };
/** PUT /api/v2/portfolio: `envelope.revision` must equal `expectedRevision + 1`. A stale revision is answered with 409. */
export type SaveEncryptedPortfolioRequest = { envelope: PortfolioEnvelope; expectedRevision: number };
export type SaveEncryptedPortfolioResponse = { revision: number };
/** Machine-readable reasons on error bodies of the vault routes. */
export type VaultErrorBody = ApiError & { code?: 'upgrade-required' | 'no-vault' | 'vault-exists' | 'conflict' | 'wrapper-conflict' };

// ---- Public market data for explicit tickers (GET /api/public-data) --------------------------------
/**
 * Shared market caches for the tickers the CLIENT names: cached quotes, PSX payout announcements and verified
 * face values. The server never loads a portfolio to infer the list, and makes no claim of ticker-access privacy:
 * the request itself shows which companies were asked about. Clients merge the answer into the decrypted portfolio.
 */
export type PublicDataResponse = {
  tickers: string[];
  /** Raw cache rows: the client merges them with its own saved quotes (newest wins, manual quotes keep precedence). */
  quoteRows: { ticker: string; price: number; as_of: string; quote_date: string; source: string; fetched_at: string }[];
  announcements: PayoutAnnouncement[];
  faceValues: Record<string, FaceValueEvidence[]>;
};
