'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  TAB_PATHS,
  allowTab,
  companyFromPathname,
  pageTitle,
  tabFromPathname,
} from '../navigation';

/** Tab + company route state kept in sync with the address bar and browser history. */
export function useUrlTab(initialPathname: string, isAdmin: boolean) {
  const [tab, setTabState] = useState(() =>
    allowTab(tabFromPathname(initialPathname), isAdmin),
  );
  const [companyTicker, setCompanyTicker] = useState(() =>
    companyFromPathname(initialPathname),
  );

  const setTab = useCallback(
    (requested: string) => {
      const next = allowTab(requested, isAdmin);
      setTabState(next);
      const path = TAB_PATHS[next] ?? '/';
      if (window.location.pathname !== path) {
        window.history.pushState(null, '', path);
      }
    },
    [isAdmin],
  );

  const openCompany = useCallback((ticker: string) => {
    setCompanyTicker(ticker);
    const path = '/company/' + encodeURIComponent(ticker);
    setTabState('company');
    if (window.location.pathname !== path)
      window.history.pushState(null, '', path);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    function onPopState() {
      setTabState(
        allowTab(tabFromPathname(window.location.pathname), isAdmin),
      );
      setCompanyTicker(companyFromPathname(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAdmin]);

  useEffect(() => {
    document.title = pageTitle(tab, companyTicker);
  }, [tab, companyTicker]);

  return { tab, companyTicker, setTab, openCompany };
}
