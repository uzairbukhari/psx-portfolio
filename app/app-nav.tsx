'use client';
// Page navigation for the signed-in app. These are pages with URLs, so they are links in a <nav> landmark (not
// ARIA tabs): new-tab and middle-click work, screen readers hear "link, current page". Plain clicks are still
// handled in-app, so the page does not reload and the vault stays unlocked.
import { Fragment, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { flushSync } from 'react-dom';
import { preloadTab } from './lazy-panels';

export type NavItem = {
  tab: string;
  href: string;
  label: string;
  short: string;
  icon: ReactNode;
  title?: string;
  /** A small tag next to the label (Beta, Admin). */
  badge?: string;
  /** Left out of the phone's bottom bar (reachable from Plan or the account menu). */
  extra?: boolean;
  /** Draws a divider above this item in the sidebar. */
  divider?: boolean;
};

/** Page names for document.title and each view's heading. */
export const PAGE_TITLES: Record<string, string> = {
  holdings: 'Holdings',
  reports: 'Insights',
  'sip-plan': 'Plan',
  'sip-tracker': 'SIP Blueprint',
  future: 'Future you',
  zakat: 'Zakat',
  feedback: 'Feedback',
  history: 'Activity',
  sip: 'Monthly Picks',
  settings: 'Settings',
  notifications: 'Notifications',
  company: 'Company',
  fund: 'Mutual fund',
  metal: 'Gold and silver',
  currency: 'Foreign currency',
  plan: 'Savings plan',
  'research-desk': 'Research desk',
  'ai-lab': 'AI Lab',
};

/** Runs a state update inside a View Transition when the browser has them and motion is allowed. */
export function withViewTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) return update();
  doc.startViewTransition(() => flushSync(update));
}

export function AppNav({
  items,
  active,
  onNavigate,
  onAdd,
  addDisabled,
  onMore,
  moreActive,
}: {
  items: NavItem[];
  active: string;
  onNavigate: (tab: string) => void;
  /** The raised add button in the middle of the phone's bottom bar. */
  onAdd?: () => void;
  addDisabled?: boolean;
  /** The phone's "More" slot at the end of the bottom bar: opens the pages and account actions that do not fit. */
  onMore?: () => void;
  moreActive?: boolean;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>, tab: string) {
    // New-tab and new-window gestures belong to the browser.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    withViewTransition(() => onNavigate(tab));
  }
  return (
    <nav data-slot="tabs-list" className="app-nav" aria-label="Main" data-tour="pages">
      {items.map((item, i) => {
        const current = item.tab === active;
        return (
          <Fragment key={item.tab}>
            {onAdd && i === 2 && (
              <button
                type="button"
                data-slot="nav-add"
                className="nav-add"
                data-tour="add"
                aria-label="Add transaction"
                disabled={addDisabled}
                onClick={onAdd}
              >
                <Plus aria-hidden="true" />
              </button>
            )}
            {item.divider && <span className="nav-sep" role="separator" />}
            <a
              href={item.href}
              data-slot="tabs-trigger"
              data-active={current ? '' : undefined}
              data-extra={item.extra ? '' : undefined}
              data-tip={item.label}
              aria-current={current ? 'page' : undefined}
              title={item.title}
              className="app-nav-link"
              onClick={(e) => onClick(e, item.tab)}
              onPointerEnter={() => preloadTab(item.tab)}
              onFocus={() => preloadTab(item.tab)}
            >
              {item.icon}
              <span className="tab-long">{item.label}</span>
              <span className="tab-short">{item.short}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </a>
          </Fragment>
        );
      })}
      {onMore && (
        <button
          type="button"
          data-slot="nav-more"
          className="nav-more"
          data-tour="profile"
          aria-haspopup="dialog"
          aria-expanded={moreActive ? true : undefined}
          onClick={onMore}
        >
          <Ellipsis className="tab-icon" aria-hidden="true" />
          <span>More</span>
        </button>
      )}
    </nav>
  );
}

/** One page of the app. Renders only while active, with an h1 that screen readers and focus can land on. */
export function NavPanel({
  id,
  tab,
  children,
}: {
  id: string;
  tab: string;
  children: ReactNode;
}) {
  if (id !== tab) return null;
  return (
    <div data-slot="tabs-content" className="flex-1 text-sm outline-none">
      <h1 className="sr-only" tabIndex={-1} data-page-heading>
        {PAGE_TITLES[id] ?? 'Sipwise'}
      </h1>
      {children}
    </div>
  );
}

/**
 * In-app navigation does not change document.title or move focus, so screen reader users get no signal that the
 * page changed. Call once with the active tab (and a detail such as the ticker on a company page).
 */
export function useRouteMeta(tab: string, detail?: string) {
  const first = useRef(true);
  useEffect(() => {
    const page = PAGE_TITLES[tab] ?? 'Sipwise';
    document.title = detail ? `${detail} · ${page} | Sipwise` : `${page} | Sipwise`;
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>('[data-page-heading]')?.focus({ preventScroll: true });
  }, [tab, detail]);
}
