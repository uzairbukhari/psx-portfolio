export const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Is the data pipeline healthy, are people using the app, and what is breaking for them.' },
  { id: 'health', label: 'System health', description: 'Every public data pipeline, queued requests and AI spend.' },
  { id: 'platform', label: 'Platform', description: 'How close the Workers are to Cloudflare\'s limits, server errors, and the Cloudflare error pages people have seen.' },
  { id: 'analytics', label: 'Usage analytics', description: 'Sign-ups, active users and feature use on web and phone. Counts only: no holdings, tickers or amounts are ever recorded. See People for individual accounts.' },
  { id: 'audit', label: 'Audit log', description: 'Errors users run into, by category and code, so you can trace a problem to a screen, platform, version or person. No error text or data is recorded.' },
  { id: 'users', label: 'People', description: 'Who uses Sipwise, how far each person got, and who needs a nudge. Activity only, never holdings or amounts.' },
  { id: 'feedback', label: 'Feedback', description: 'Messages from the Contact us, Report an issue and Suggest a feature page, from signed-in and signed-out visitors. Only what people typed; never portfolio data.' },
  { id: 'accounts', label: 'Accounts', description: 'Super admins and test accounts. Internal accounts are left out of usage analytics.' },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]['id'];
