import { useQuery } from '@tanstack/react-query';
import type { FundNavRow } from '@shared/mufap.ts';
import { useVault } from '@/vault/VaultProvider';

/** MUFAP's newest price for every fund. The request has no parameters, so it says nothing about what you hold. */
export function useFundNavs(enabled: boolean): { navs: FundNavRow[]; error: string } {
  const { publicData } = useVault();
  const query = useQuery({
    queryKey: ['fund-navs'],
    enabled,
    staleTime: 15 * 60_000,
    queryFn: async () => ((await publicData.funds?.())?.funds ?? []).flatMap((f) => (f.latest ? [f.latest] : [])),
  });
  return { navs: query.data ?? [], error: query.error instanceof Error ? query.error.message : '' };
}
