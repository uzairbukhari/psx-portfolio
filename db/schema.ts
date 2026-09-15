import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
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

export const researchHelpers = sqliteTable(
  'research_helpers',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [index('idx_research_helpers_user_id').on(table.userId)],
);

export const quoteRefreshes = sqliteTable(
  'quote_refreshes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tickers: text('tickers').notNull(),
    status: text('status').notNull(),
    result: text('result'),
    error: text('error'),
    leaseOwner: text('lease_owner'),
    leaseUntil: text('lease_until'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_quote_refreshes_user_updated').on(table.userId, table.updatedAt),
    index('idx_quote_refreshes_status_lease').on(table.status, table.leaseUntil),
  ],
);
