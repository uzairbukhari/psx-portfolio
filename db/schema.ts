import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
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
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_monthly_recommendations_user_created').on(
      table.userId,
      table.createdAt,
    ),
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
});

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

export const marketSummaryRefreshes = sqliteTable('market_summary_refreshes', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
