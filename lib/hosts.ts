// Two public hosts, one Worker: the marketing site on `MARKETING_HOST` (sipwise.trade) and the app on `APP_HOST`
// (app.sipwise.trade). Both vars empty (local, sandbox, staging) means a single host, as before. Pure: callers pass the
// request host and the two vars, so this is shared by routes, pages and tests.

export type HostRole = 'marketing' | 'app' | 'single';

export type HostConfig = { marketingHost?: string | null; appHost?: string | null };

/** `Host` header value without port, lower case. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
}

export function splitEnabled(cfg: HostConfig): boolean {
  return Boolean(normalizeHost(cfg.marketingHost) && normalizeHost(cfg.appHost));
}

export function hostRole(host: string | null | undefined, cfg: HostConfig): HostRole {
  if (!splitEnabled(cfg)) return 'single';
  const h = normalizeHost(host);
  if (h === normalizeHost(cfg.marketingHost)) return 'marketing';
  if (h === normalizeHost(cfg.appHost)) return 'app';
  // Any other host (the old *.workers.dev address installed phones use) keeps behaving like the app.
  return 'single';
}

/** Where an app link on the marketing site points: the app host when the split is on, otherwise the same site. */
export function appOrigin(cfg: HostConfig): string {
  return splitEnabled(cfg) ? `https://${normalizeHost(cfg.appHost)}` : '';
}

export function marketingOrigin(cfg: HostConfig): string {
  return splitEnabled(cfg) ? `https://${normalizeHost(cfg.marketingHost)}` : '';
}

/** Closed list of places a Google sign-in button sits on the marketing site; anything else is dropped. */
export const SIGNUP_SOURCES = [
  'home_hero',
  'home_nav',
  'home_tour',
  'home_calculator',
  'home_pricing',
  'home_final',
  'features',
  'security',
  'pricing',
  'guide',
] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export function parseSignupSource(value: string | null | undefined): SignupSource | null {
  return SIGNUP_SOURCES.find((s) => s === value) ?? null;
}

/** Sign-in link used by every marketing button. */
export function signInHref(cfg: HostConfig, src: SignupSource, returnTo = '/'): string {
  return `${appOrigin(cfg)}/api/auth/google/login?return_to=${encodeURIComponent(returnTo)}&src=${src}`;
}

/** Paths the marketing host serves itself; everything else is an app page and moves to the app host. */
const MARKETING_PATHS = new Set(['/', '/features', '/security', '/pricing', '/guide', '/privacy', '/terms', '/download', '/feedback', '/contact']);

export function isMarketingPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return MARKETING_PATHS.has(p);
}

export function robotsTxt(role: HostRole, cfg: HostConfig): string {
  if (role === 'app') return 'User-agent: *\nDisallow: /\n';
  const sitemap = `${marketingOrigin(cfg) || 'https://sipwise.trade'}/sitemap.xml`;
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /features',
    'Allow: /security',
    'Allow: /pricing',
    'Allow: /guide',
    'Allow: /privacy',
    'Allow: /terms',
    'Allow: /download',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /company/',
    'Disallow: /funds/',
    'Disallow: /gold/',
    'Disallow: /plans/',
    'Disallow: /reports',
    'Disallow: /activity',
    'Disallow: /history',
    'Disallow: /sip',
    'Disallow: /settings',
    'Disallow: /notifications',
    'Disallow: /ai-lab',
    'Disallow: /research-desk',
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');
}

export function sitemapXml(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
