export const ADMIN_SECTIONS = [
  { id: 'health', label: 'System health', description: 'Data freshness and recent scrape failures for the public data pipeline.' },
  { id: 'analytics', label: 'Usage analytics', description: 'Sign-ups, active users and feature use on web and phone. Counts only: no holdings, tickers or amounts are ever recorded.' },
  { id: 'audit', label: 'Audit log', description: 'Errors users run into, by category and code, so you can trace a problem to a screen, platform, version or person. No error text or data is recorded.' },
  { id: 'accounts', label: 'Accounts', description: 'Super admins and test accounts. Internal accounts are left out of usage analytics.' },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]['id'];
