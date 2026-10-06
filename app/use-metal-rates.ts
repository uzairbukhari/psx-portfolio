'use client';

import { useEffect, useState } from 'react';
import type { MetalRateRow } from '@/lib/metal-rates';
import { webPublicData } from './vault-transport';

/** Public gold and silver rates, fetched once per page load. The request carries no information about what you hold. */
export function useMetalRates(enabled: boolean) {
  const [state, setState] = useState<{
    rates: MetalRateRow[];
    error: string;
    loaded: boolean;
  }>({ rates: [], error: '', loaded: false });
  useEffect(() => {
    if (!enabled || state.loaded) return;
    let live = true;
    webPublicData
      .metalRates?.()
      .then((rates) => live && setState({ rates, error: '', loaded: true }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            rates: [],
            error:
              e instanceof Error
                ? e.message
                : 'Could not load gold and silver rates.',
            loaded: true,
          }),
      );
    return () => {
      live = false;
    };
  }, [enabled, state.loaded]);
  return state;
}
