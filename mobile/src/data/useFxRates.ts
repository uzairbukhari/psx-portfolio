import { useQuery } from '@tanstack/react-query';
import type { FxRateRow } from '@shared/fx-rates.ts';
import { useVault } from '@/vault/VaultProvider';

/** Public USD, AED and SAR rates. The request has no parameters, so it says nothing about what you hold. */
export function useFxRates(enabled: boolean): { rates: FxRateRow[]; error: string } {
  const { publicData } = useVault();
  const query = useQuery({
    queryKey: ['fx-rates'],
    enabled,
    staleTime: 15 * 60_000,
    queryFn: async () => (await publicData.fxRates?.()) ?? [],
  });
  return { rates: query.data ?? [], error: query.error instanceof Error ? query.error.message : '' };
}
