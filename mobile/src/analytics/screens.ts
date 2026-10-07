import type { EventProps } from '../../../lib/analytics-events.ts';

/** Route path -> screen name in the usage catalog; paths without a catalog name are not recorded. */
export function screenForPath(path: string): EventProps['screen'] | null {
  const clean = path.split('?')[0].replace(/\/$/, '') || '/';
  if (clean.startsWith('/company/')) return 'company';
  const names: Record<string, string> = {
    '/': 'today',
    '/portfolio': 'portfolio',
    '/plan': 'plan',
    '/activity': 'activity',
    '/more': 'more',
    '/inbox': 'inbox',
    '/portfolios': 'overview',
    '/reports': 'reports',
    '/picks': 'sip',
    '/sip': 'sip',
  };
  return names[clean] ?? null;
}
