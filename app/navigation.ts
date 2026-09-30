/** Single source of truth for app destinations. Stage 3 adds SIP / reorganised Research by editing this list only. */
export type TabId =
  | 'holdings'
  | 'history'
  | 'sip'
  | 'reports'
  | 'research-desk'
  | 'settings'
  | 'notifications'
  | 'company';

export type NavItem = {
  id: Exclude<TabId, 'company'>;
  label: string;
  /** Shorter label for the compact mobile bar. */
  shortLabel: string;
  path: string;
  adminOnly?: boolean;
  /** Shown in the primary navigation (otherwise only reachable from the header). */
  primary?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'holdings', label: 'Overview', shortLabel: 'Overview', path: '/', primary: true },
  { id: 'history', label: 'Activity', shortLabel: 'Activity', path: '/history', primary: true },
  { id: 'sip', label: 'Monthly Picks', shortLabel: 'Picks', path: '/sip', primary: true },
  { id: 'reports', label: 'Reports', shortLabel: 'Reports', path: '/reports', primary: true },
  {
    id: 'research-desk',
    label: 'Research desk',
    shortLabel: 'Research',
    path: '/research-desk',
    primary: true,
    adminOnly: true,
  },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', path: '/settings' },
  { id: 'notifications', label: 'Notifications', shortLabel: 'Alerts', path: '/notifications' },
];

export const TAB_PATHS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item.path]),
);
const PATH_TABS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.path, item.id]),
);

const COMPANY_PATH = new RegExp('^/company/([A-Za-z0-9]{2,12})/?$');

export function companyFromPathname(pathname: string): string {
  const match = COMPANY_PATH.exec(pathname);
  return match ? match[1].toUpperCase() : '';
}

/** Non-admins never land on admin-only destinations, even via a direct URL or history entry. */
export function allowTab(tab: string, isAdmin: boolean): string {
  const item = NAV_ITEMS.find((entry) => entry.id === tab);
  return item?.adminOnly && !isAdmin ? 'holdings' : tab;
}

export function tabFromPathname(pathname: string): string {
  const normalised =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return companyFromPathname(pathname)
    ? 'company'
    : (PATH_TABS[normalised] ?? 'holdings');
}

/** Tabs that render without the overview chrome (page title, primary tabs). */
export const CHROMELESS_TABS: ReadonlySet<string> = new Set([
  'settings',
  'company',
  'notifications',
]);

export function pageTitle(tab: string, ticker = ''): string {
  if (tab === 'company' && ticker) return `${ticker} — FolioRaah`;
  const item = NAV_ITEMS.find((entry) => entry.id === tab);
  return !item || item.id === 'holdings'
    ? 'FolioRaah — PSX Portfolio & SIP Tracker'
    : `${item.label} — FolioRaah`;
}
