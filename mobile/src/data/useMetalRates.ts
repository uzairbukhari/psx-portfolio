import { useQuery } from '@tanstack/react-query';
import type { MetalRateRow } from '@shared/metal-rates.ts';
import { useVault } from '@/vault/VaultProvider';

/** Public gold and silver rates. The request has no parameters, so it says nothing about what you hold. */
export function useMetalRates(enabled: boolean): { rates: MetalRateRow[]; error: string } {
  const { publicData } = useVault();
  const query = useQuery({
    queryKey: ['metal-rates'],
    enabled,
    staleTime: 15 * 60_000,
    queryFn: async () => (await publicData.metalRates?.()) ?? [],
  });
  return { rates: query.data ?? [], error: query.error instanceof Error ? query.error.message : '' };
}
