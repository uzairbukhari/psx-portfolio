'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FundCatalogResponse, FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';
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
      // An empty directory means the nightly run has not happened yet: ask for it once, then read it again.
      .then(async (r) => {
        if (r.funds.length || !webPublicData.trackFunds) return r;
        await webPublicData.trackFunds([]);
        return (await webPublicData.funds?.()) ?? r;
      })
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
  const reload = useCallback(
    () => setState((s) => ({ ...s, loaded: false })),
    [],
  );
  return { ...state, navs, reload };
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

/** Tells the server which funds are held (public MUFAP ids only, once per set) so their price is stored nightly. */
export function useTrackFunds(mufapIds: string[], onTracked?: () => void) {
  const sent = useRef('');
  const [error, setError] = useState('');
  const key = [...new Set(mufapIds)].sort().join(',');
  useEffect(() => {
    if (!key || sent.current === key) return;
    sent.current = key;
    webPublicData
      .trackFunds?.(key.split(','))
      .then((r) => {
        setError(r?.error ?? '');
        if (!r?.error) onTracked?.();
      })
      .catch((e: unknown) => {
        sent.current = '';
        setError(
          e instanceof Error ? e.message : 'Could not fetch fund prices.',
        );
      });
  }, [key, onTracked]);
  return { error };
}

/** Pak-Qatar sub-fund unit prices, fetched once per page load and only when a plan needs them. */
export function usePlanNavs(enabled: boolean) {
  const [state, setState] = useState<{
    navs: PlanNavRow[];
    error: string;
    loaded: boolean;
  }>({ navs: [], error: '', loaded: false });
  useEffect(() => {
    if (!enabled || state.loaded) return;
    let live = true;
    webPublicData.planNavs?.().then(
      (r) =>
        live && setState({ navs: r.navs, error: r.error ?? '', loaded: true }),
      (e: unknown) =>
        live &&
        setState({
          navs: [],
          error: e instanceof Error ? e.message : 'Could not load prices.',
          loaded: true,
        }),
    );
    return () => {
      live = false;
    };
  }, [enabled, state.loaded]);
  return state;
}
