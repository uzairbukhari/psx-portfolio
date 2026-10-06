// Everything DELETE /api/me removes for the signed-in user. Pure (no Workers imports) so tests can
// check the table list against db/schema.ts: a new per-user table must be added here or to
// SHARED_TABLES, and tests/account-deletion.test.mjs fails until it is.

/**
 * Per-user tables and the column holding the user's email (lower-case). The encrypted vault lives in the separate
 * VAULT_DB and is removed by deleteVault (lib/vault-store.ts); `portfolios`, `ai_reviews` and `monthly_recommendations`
 * are legacy plaintext tables that nothing writes any more but that older deployments may still hold.
 */
export const USER_TABLES: readonly { table: string; column: string }[] = [
  { table: 'portfolios', column: 'user_id' },
  { table: 'ai_reviews', column: 'user_id' },
  { table: 'ai_usage', column: 'user_id' },
  { table: 'monthly_recommendations', column: 'user_id' },
  { table: 'research_jobs', column: 'user_id' },
  { table: 'rate_limits', column: 'user_id' },
  { table: 'mobile_sessions', column: 'email' },
  { table: 'user_roles', column: 'email' },
];

/** Child tables keyed through a per-user parent row; deleted before the parent so the link still exists. */
export const CHILD_TABLES: readonly { table: string; column: string; parent: string; parentKey: string; parentUser: string }[] = [
  { table: 'recommendation_attempts', column: 'recommendation_id', parent: 'monthly_recommendations', parentKey: 'id', parentUser: 'user_id' },
  { table: 'research_events', column: 'job_id', parent: 'research_jobs', parentKey: 'id', parentUser: 'user_id' },
];

/** Shared caches that hold no per-user data and are left alone. */
export const SHARED_TABLES: readonly string[] = [
  'quote_refreshes',
  'company_facts',
  'facts_requests',
  'market_summary_refreshes',
  'dividend_announcements',
  'price_history',
  'refresh_state',
  'security_catalog',
  'security_face_values',
  'corporate_actions',
  'metal_rates',
  'fund_catalog',
  'fund_navs',
  'refresh_requests',
  'ipo_offers',
  'ai_research_runs',
  'ai_macro_briefs',
  'ai_company_profiles',
  'ai_financial_extracts',
  'ai_news_items',
  'ai_company_research',
  'ai_rankings',
  'ai_research_requests',
];

/** SQL statements (child rows first) with the single bound email each one takes. */
export function accountDeletionStatements(): string[] {
  return [
    ...CHILD_TABLES.map(
      (c) => `DELETE FROM ${c.table} WHERE ${c.column} IN (SELECT ${c.parentKey} FROM ${c.parent} WHERE ${c.parentUser}=?)`,
    ),
    ...USER_TABLES.map((t) => `DELETE FROM ${t.table} WHERE ${t.column}=?`),
  ];
}

/** True when the typed confirmation is the signed-in email (case and surrounding spaces ignored). */
export function confirmationMatches(confirm: unknown, email: string): boolean {
  return typeof confirm === 'string' && confirm.trim().toLowerCase() === email.trim().toLowerCase();
}
