export const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Is the data pipeline healthy, are people using the app, and what is breaking for them.' },
  { id: 'health', label: 'System health', group: 'System', description: 'Every public data pipeline, queued requests and AI spend.' },
  { id: 'platform', label: 'Platform', group: 'System', description: 'How close the Workers are to Cloudflare\'s limits, server errors, and the Cloudflare error pages people have seen.' },
  { id: 'pulse', label: 'Summary', group: 'Analytics', description: 'The state of the product this period against the one before: who is active, who signs up and sticks, how long visits last and how often the app breaks.' },
  { id: 'journeys', label: 'Journeys', group: 'Analytics', description: 'What people do in which order: funnels you build from any event, the paths around a screen, and how long the first steps take.' },
  { id: 'engagement', label: 'Engagement', group: 'Analytics', description: 'How often people come back and what they use: active users, cohorts, lifecycle, visit length and feature adoption.' },
  { id: 'acquisition', label: 'Acquisition', group: 'Analytics', description: 'Where new people come from, which sources turn into active users, and the countries, devices and releases they use.' },
  { id: 'quality', label: 'Quality', group: 'Analytics', description: 'Crash-free visits, errors per release and screen, page speed (Core Web Vitals) and how long key steps take.' },
  { id: 'analytics', label: 'Usage counts', group: 'Analytics', description: 'Sign-ups, active users and feature use on web and phone. Counts only: no holdings, tickers or amounts are ever recorded. See People for individual accounts.' },
  { id: 'users', label: 'People', group: 'Analytics', description: 'Who uses Sipwise, how far each person got, and who needs a nudge. Activity only, never holdings or amounts.' },
  { id: 'audit', label: 'Audit log', group: 'Support', description: 'Errors users run into, by category and code, so you can trace a problem to a screen, platform, version or person. No error text or data is recorded.' },
  { id: 'feedback', label: 'Feedback', group: 'Support', description: 'Messages from the Contact us, Report an issue and Suggest a feature page, from signed-in and signed-out visitors. Only what people typed; never portfolio data.' },
  { id: 'accounts', label: 'Accounts', group: 'Support', description: 'Super admins and test accounts. Internal accounts are left out of usage analytics.' },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]['id'];
/** The sections that read the Analytics lenses (GET /api/admin/analytics?lens=). */
export const LENS_OF_SECTION = { pulse: 'summary', journeys: 'journeys', engagement: 'engagement', acquisition: 'acquisition', quality: 'quality' } as const;
export type LensSection = keyof typeof LENS_OF_SECTION;
export const isLensSection = (s: string): s is LensSection => Object.hasOwn(LENS_OF_SECTION, s);
