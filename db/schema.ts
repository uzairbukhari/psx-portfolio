import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
export const portfolios = sqliteTable('portfolios', {
  userId: text('user_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const reviews = sqliteTable(
  'ai_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    revision: integer('revision').notNull(),
    month: text('month').notNull(),
    status: text('status').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_ai_reviews_user_created').on(table.userId, table.createdAt),
  ],
);

export const monthlyRecommendations = sqliteTable(
  'monthly_recommendations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    month: text('month').notNull(),
    amount: real('amount').notNull(),
    feePct: real('fee_pct').notNull().default(0),
    shortlist: text('shortlist').notNull(),
    status: text('status').notNull(),
    providerResponseId: text('provider_response_id'),
    result: text('result'),
    sources: text('sources'),
    error: text('error'),
    model: text('model').notNull(),
    estimatedCostUsd: real('estimated_cost_usd'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    workflowVersion: integer('workflow_version').notNull().default(1),
    snapshot: text('snapshot'),
    gatherStartedAt: text('gather_started_at'),
    pendingTickers: text('pending_tickers'),
    // Durable execution: the cron processor claims a run with a lease token, advances it one
    // step, and releases it. A run is due when `next_attempt_at` has passed and no live lease exists.
    nextAttemptAt: text('next_attempt_at'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: text('lease_expires_at'),
    deadlineAt: text('deadline_at'),
    // Persisted, user-visible progress (JSON): phase milestone plus real company counts.
    progress: text('progress'),
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_monthly_recommendations_user_created').on(
      table.userId,
      table.createdAt,
    ),
    index('idx_monthly_recommendations_due').on(table.status, table.nextAttemptAt),
    uniqueIndex('uq_monthly_recommendations_idem').on(table.userId, table.idempotencyKey),
  ],
);

export const researchJobs = sqliteTable(
  'research_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    ticker: text('ticker').notNull(),
    companyName: text('company_name').notNull(),
    sector: text('sector').notNull().default('Unknown'),
    status: text('status').notNull(),
    stage: text('stage').notNull(),
    message: text('message').notNull().default(''),
    budgetMicros: integer('budget_micros').notNull().default(500000),
    spentMicros: integer('spent_micros').notNull().default(0),
    reportsFound: integer('reports_found').notNull().default(0),
    checkpoint: text('checkpoint'),
    result: text('result'),
    // AI settings (model, budget, ...) the client chose when it queued the job. Never holdings or notes.
    settings: text('settings'),
    error: text('error'),
    leaseOwner: text('lease_owner'),
    leaseUntil: text('lease_until'),
    cancelRequested: integer('cancel_requested', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_research_jobs_user_updated').on(table.userId, table.updatedAt),
    index('idx_research_jobs_status_lease').on(table.status, table.leaseUntil),
  ],
);

export const researchEvents = sqliteTable(
  'research_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id').notNull(),
    stage: text('stage').notNull(),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_research_events_job_id').on(table.jobId, table.id)],
);

export const quoteRefreshes = sqliteTable('quote_refreshes', {
  ticker: text('ticker').primaryKey(),
  price: real('price').notNull(),
  asOf: text('as_of').notNull(),
  quoteDate: text('quote_date').notNull(),
  source: text('source').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // When PSX says the price was quoted (ISO, from the display time in `as_of`); null when unknown.
  observedAt: text('observed_at'),
});

// Refresh attempts, kept apart from observations: a failed attempt never changes how old a stored
// price looks, and the oldest-attempted ticker is serviced first so no symbol is starved.
export const refreshState = sqliteTable(
  'refresh_state',
  {
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    lastAttemptAt: text('last_attempt_at'),
    lastSuccessAt: text('last_success_at'),
    lastError: text('last_error'),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.kind, table.key] })],
);

// Shared catalog of securities seen in validated PSX observations (the All-Share table). It records
// what PSX lists, not issuer identity: `security_type` stays null until a source states it.
export const securityCatalog = sqliteTable('security_catalog', {
  ticker: text('ticker').primaryKey(),
  name: text('name').notNull(),
  sector: text('sector'),
  securityType: text('security_type'),
  source: text('source').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  // Company directory (scripts/psx-directory-scrape.mjs). Provenance is kept per field: the name and sector
  // can come from different sources, and nothing here is ever promoted from a user's own portfolio data.
  sectorCode: text('sector_code'),
  sectorName: text('sector_name'),
  nameSource: text('name_source'),
  sectorSource: text('sector_source'),
  sourceUrls: text('source_urls'),
  // 'resolved' = name and sector both verified from PSX/issuer data; 'incomplete' = something missing;
  // 'unresolved' = a lookup was tried and the evidence was insufficient.
  resolutionStatus: text('resolution_status').notNull().default('incomplete'),
  listingStatus: text('listing_status'),
  verifiedAt: text('verified_at'),
  profileFetchedAt: text('profile_fetched_at'),
  // Hash of the observed fields, so an incremental run can tell a changed listing from an unchanged one.
  fingerprint: text('fingerprint'),
  // Current verified face value (Rs); the dated evidence lives in security_face_values.
  faceValue: real('face_value'),
  faceValueSource: text('face_value_source'),
  faceValueVerifiedAt: text('face_value_verified_at'),
});

// Dated face-value evidence per ticker. A capital change (split / consolidation) adds a row with a later
// `effective_from` instead of overwriting the old one, so a past dividend keeps the face value that applied then.
export const securityFaceValues = sqliteTable(
  'security_face_values',
  {
    ticker: text('ticker').notNull(),
    // First date this face value applied; '' = from the earliest date the evidence covers.
    effectiveFrom: text('effective_from').notNull().default(''),
    faceValue: real('face_value').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceLabel: text('source_label'),
    evidence: text('evidence'),
    verifiedAt: text('verified_at').notNull(),
    // 'verified', or 'conflict' when a second source disagreed for the same start date: a conflicting row is
    // never used to calculate anything (the value stays unresolved) and the disagreement is kept in `evidence`.
    status: text('status').notNull().default('verified'),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.effectiveFrom] })],
);

// Public corporate actions (splits) used to propose missing splits while importing a broker file. Rows are curated
// against a PSX notice or company announcement and always carry their source; no user data is ever written here.
export const corporateActions = sqliteTable(
  'corporate_actions',
  {
    ticker: text('ticker').notNull(),
    kind: text('kind').notNull().default('split'),
    // First trading day on the new share basis.
    effectiveDate: text('effective_date').notNull(),
    oldShares: integer('old_shares').notNull(),
    newShares: integer('new_shares').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceLabel: text('source_label'),
    verification: text('verification').notNull().default('curated'),
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.kind, t.effectiveDate] })],
);

export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    source: text('source').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_ai_usage_user_created').on(table.userId, table.createdAt)],
);

// Shared, public PSX company-page facts (price, financials, ratios, announcements) used
// by Monthly Picks scoring. Cached per calendar day so a shortlist re-run within the same
// day costs zero extra fetches; refreshed the same way `quote_refreshes` is, independent
// of any single user's save/revision state.
export const companyFacts = sqliteTable('company_facts', {
  ticker: text('ticker').primaryKey(),
  fetchedOn: text('fetched_on').notNull(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

// Tracks on-demand PSX facts scrapes (GitHub Actions workflow_dispatch): dedupes
// dispatches and surfaces the last scrape error per ticker.
export const factsRequests = sqliteTable('facts_requests', {
  ticker: text('ticker').primaryKey(),
  requestedAt: text('requested_at').notNull(),
  attemptedAt: text('attempted_at'),
  error: text('error'),
});

export const marketSummaryRefreshes = sqliteTable('market_summary_refreshes', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Durable provider attempts: retain evidence and charge each request once.
export const recommendationAttempts = sqliteTable('recommendation_attempts', {
  id: text('id').primaryKey(),
  recommendationId: text('recommendation_id').notNull(),
  phase: text('phase').notNull(),
  cycle: integer('cycle').notNull(),
  batchKey: text('batch_key').notNull().default('legacy'),
  state: text('state').notNull(),
  providerResponseId: text('provider_response_id'),
  request: text('request').notNull(),
  response: text('response'),
  reservedUsd: real('reserved_usd').notNull(),
  costUsd: real('cost_usd'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_recommendation_attempts_run').on(t.recommendationId)]);

// Shared (not per-user) PSX payout announcements, scraped outside Cloudflare
// by scripts/psx-payout-scrape.mjs. Portfolios turn these into dividends.
export const dividendAnnouncements = sqliteTable(
  'dividend_announcements',
  {
    ticker: text('ticker').notNull(),
    bookClosureStart: text('book_closure_start').notNull(),
    kind: text('kind').notNull(),
    bookClosureEnd: text('book_closure_end').notNull(),
    announcedOn: text('announced_on').notNull(),
    period: text('period').notNull(),
    details: text('details').notNull(),
    percent: real('percent'),
    perShareRs: real('per_share_rs'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.bookClosureStart, t.announcedOn, t.kind] })],
);

// Per-ticker PSX price history for the company page chart. Written by the GitHub
// Actions scrapers (PSX blocks Cloudflare egress): `eod` is daily closes as
// [unixSec, close] pairs, `intraday` is today's downsampled [unixSec, price] ticks.
export const priceHistory = sqliteTable('price_history', {
  ticker: text('ticker').primaryKey(),
  eod: text('eod').notNull().default('[]'),
  intraday: text('intraday').notNull().default('[]'),
  eodFetchedAt: text('eod_fetched_at'),
  intradayFetchedAt: text('intraday_fetched_at'),
});

// Role assignments by email. No row means the default 'user' role.
export const userRoles = sqliteTable('user_roles', {
  email: text('email').primaryKey(),
  role: text('role').notNull(),
  createdAt: text('created_at').notNull(),
});

// Per-user fixed-window rate limits for expensive actions (forced PSX refreshes,
// on-demand facts scrapes). One row per user and action.
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    userId: text('user_id').notNull(),
    action: text('action').notNull(),
    windowStart: text('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.action] })],
);

// One row per signed-in phone/tablet. The app token carries the row id (`sid`),
// so revoking a row signs that device out on its next request.
export const mobileSessions = sqliteTable(
  'mobile_sessions',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    deviceName: text('device_name').notNull(),
    platform: text('platform').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    revokedAt: text('revoked_at'),
    // Expo push token of this device, set by the app after sign-in; used by the dividend notifier.
    pushToken: text('push_token'),
  },
  (table) => [index('mobile_sessions_email_idx').on(table.email)],
);

// Per-company, per-kind state of on-demand GitHub Actions scrapes ('payouts' = historical dividend
// announcements, 'ipo' = official offer evidence). Written by the Worker (queued) and the scraper
// (running / completed / failed); the status API derives the user-visible state from it.
export const refreshRequests = sqliteTable(
  'refresh_requests',
  {
    kind: text('kind').notNull(),
    ticker: text('ticker').notNull(),
    status: text('status').notNull(),
    requestedAt: text('requested_at').notNull(),
    dispatchedAt: text('dispatched_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    attempts: integer('attempts').notNull().default(0),
    rowsFound: integer('rows_found'),
    coverageFrom: text('coverage_from'),
    error: text('error'),
    // Quote refreshes: 'updated' | 'already_current' | 'fallback_used' | 'failed'.
    outcome: text('outcome'),
  },
  (t) => [primaryKey({ columns: [t.kind, t.ticker] })],
);

// Official IPO / offer-for-sale evidence found by scripts/psx-ipo-scrape.mjs (see lib/ipo-offers.ts).
export const ipoOffers = sqliteTable('ipo_offers', {
  ticker: text('ticker').primaryKey(),
  status: text('status').notNull(),
  offerPrice: real('offer_price'),
  allotmentDate: text('allotment_date'),
  listingDate: text('listing_date'),
  evidence: text('evidence'),
  verification: text('verification'),
  reason: text('reason'),
  error: text('error'),
  checkedAt: text('checked_at').notNull(),
});

// AI Lab (experimental, super admin): public AI research keyed by ticker. Nothing here refers to an account,
// holding or amount; the job that writes it (scripts/ai-research.mjs) never sees any private data.
export const aiResearchRuns = sqliteTable('ai_research_runs', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  provider: text('provider').notNull(),
  models: text('models').notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  stats: text('stats'),
  error: text('error'),
}, (t) => [index('idx_ai_research_runs_started').on(t.startedAt)]);

export const aiMacroBriefs = sqliteTable('ai_macro_briefs', {
  month: text('month').primaryKey(),
  payload: text('payload').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
});

export const aiCompanyProfiles = sqliteTable('ai_company_profiles', {
  ticker: text('ticker').primaryKey(),
  payload: text('payload').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
});

export const aiFinancialExtracts = sqliteTable('ai_financial_extracts', {
  ticker: text('ticker').notNull(),
  docKey: text('doc_key').notNull(),
  period: text('period'),
  payload: text('payload').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.ticker, t.docKey] })]);

export const aiNewsItems = sqliteTable('ai_news_items', {
  url: text('url').primaryKey(),
  ticker: text('ticker').notNull(),
  publishedOn: text('published_on'),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_ai_news_ticker').on(t.ticker, t.publishedOn)]);

export const aiCompanyResearch = sqliteTable('ai_company_research', {
  ticker: text('ticker').primaryKey(),
  payload: text('payload').notNull(),
  inputsHash: text('inputs_hash').notNull(),
  priceAtReport: real('price_at_report'),
  researchedAt: text('researched_at').notNull(),
  checkedAt: text('checked_at').notNull(),
  carriedForward: integer('carried_forward').notNull().default(0),
  model: text('model').notNull(),
});

export const aiRankings = sqliteTable('ai_rankings', {
  id: text('id').primaryKey(),
  month: text('month').notNull(),
  tickersHash: text('tickers_hash').notNull(),
  payload: text('payload').notNull(),
  prices: text('prices').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_ai_rankings_month').on(t.month, t.createdAt)]);

// Ticker-only research requests (no account id). `status`: queued | researching | ready | failed.
export const aiResearchRequests = sqliteTable('ai_research_requests', {
  ticker: text('ticker').primaryKey(),
  requestedAt: text('requested_at').notNull(),
  status: text('status').notNull().default('queued'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  error: text('error'),
});

// Shared gold and silver prices (rupees per tola of pure metal). `local` is the Pakistani dealer rate, `international`
// the world spot price converted to rupees. Public data only; written by scripts/metal-rates-scrape.mjs.
export const metalRates = sqliteTable(
  'metal_rates',
  {
    date: text('date').notNull(),
    metal: text('metal').notNull(),
    kind: text('kind').notNull(),
    pkrPerTola: real('pkr_per_tola').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceLabel: text('source_label'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.metal, t.kind] })],
);
