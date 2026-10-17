'use client';

import { useEffect, useState } from 'react';
import type { FxRatesResponse } from '@/lib/fx-rates';
import { webPublicData } from './vault-transport';

const EMPTY: FxRatesResponse = { rates: [], history: [] };

/** Public USD, AED and SAR rates with their history, fetched once per page load. The request carries no information about what you hold. */
export function useFxRates(enabled: boolean) {
  const [state, setState] = useState<{
    data: FxRatesResponse;
    error: string;
    loaded: boolean;
  }>({ data: EMPTY, error: '', loaded: false });
  useEffect(() => {
    if (!enabled || state.loaded) return;
    let live = true;
    webPublicData
      .fxData?.()
      .then((data) => live && setState({ data, error: '', loaded: true }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            data: EMPTY,
            error:
              e instanceof Error
                ? e.message
                : 'Could not load foreign currency rates.',
            loaded: true,
          }),
      );
    return () => {
      live = false;
    };
  }, [enabled, state.loaded]);
  return state;
}
