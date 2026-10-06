'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FundCatalogResponse, FundNavRow } from '@/lib/mufap';
import { webPublicData } from './vault-transport';

type Catalog = FundCatalogResponse['funds'];

/** MUFAP's fund directory with each fund's newest price, fetched once per page load (and only when it is needed). */
export function useFundCatalog(enabled: boolean) {
  const [state, setState] = useState<{
    funds: Catalog;
    error: string;
    loaded: boolean;
  }>({ funds: [], error: '', loaded: false });
  useEffect(() => {
    if (!enabled || state.loaded) return;
    let live = true;
    webPublicData
      .funds?.()
      .then(
        (r) => live && setState({ funds: r.funds, error: '', loaded: true }),
      )
      .catch(
        (e: unknown) =>
          live &&
          setState({
            funds: [],
            error:
              e instanceof Error ? e.message : 'Could not load fund prices.',
            loaded: true,
          }),
      );
    return () => {
      live = false;
    };
  }, [enabled, state.loaded]);
  const navs: FundNavRow[] = state.funds.flatMap((f) =>
    f.latest ? [f.latest] : [],
  );
  return { ...state, navs };
}

/** One fund's stored price history, loaded when you open its chart. */
export function useFundHistory(mufapId: string, enabled: boolean) {
  const [state, setState] = useState<{
    navs: FundNavRow[];
    error: string;
    loaded: boolean;
  }>({ navs: [], error: '', loaded: false });
  const load = useCallback(() => {
    webPublicData
      .fundHistory?.(mufapId)
      .then((r) => setState({ navs: r.navs, error: '', loaded: true }))
      .catch((e: unknown) =>
        setState({
          navs: [],
          error:
            e instanceof Error
              ? e.message
              : 'Could not load the price history.',
          loaded: true,
        }),
      );
  }, [mufapId]);
  useEffect(() => {
    if (enabled && !state.loaded) load();
  }, [enabled, state.loaded, load]);
  return state;
}
