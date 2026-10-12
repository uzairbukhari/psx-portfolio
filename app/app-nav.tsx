'use client';
// Page navigation for the signed-in app. These are pages with URLs, so they are links in a <nav> landmark (not
// ARIA tabs): new-tab and middle-click work, screen readers hear "link, current page". Plain clicks are still
// handled in-app, so the page does not reload and the vault stays unlocked.
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { preloadTab } from './lazy-panels';

export type NavItem = {
  tab: string;
  href: string;
  label: string;
  short: string;
  icon: ReactNode;
  title?: string;
};

/** Page names for document.title and each view's heading. */
export const PAGE_TITLES: Record<string, string> = {
  holdings: 'Holdings',
  reports: 'Reports',
  history: 'Activity',
  sip: 'Monthly Picks',
  settings: 'Settings',
  notifications: 'Notifications',
  company: 'Company',
  fund: 'Mutual fund',
  metal: 'Gold and silver',
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
}: {
  items: NavItem[];
  active: string;
  onNavigate: (tab: string) => void;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>, tab: string) {
    // New-tab and new-window gestures belong to the browser.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    withViewTransition(() => onNavigate(tab));
  }
  return (
    <nav data-slot="tabs-list" className="app-nav" aria-label="Main">
      {items.map((item) => {
        const current = item.tab === active;
        return (
          <a
            key={item.tab}
            href={item.href}
            data-slot="tabs-trigger"
            data-active={current ? '' : undefined}
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
          </a>
        );
      })}
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
