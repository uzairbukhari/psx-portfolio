// The public-data client the decrypted portfolio is merged with: quotes, announcements, face values and company
// details for tickers the client names. Shared by the web app and the mobile app; the caller supplies how to make a
// request. Only ticker symbols ever leave the device through here.
import type {
  CompaniesResponse,
  CompanyLookup,
  PublicDataResponse,
} from './api-types.ts';
import type { PublicData } from './portfolio-view.ts';
import type { MetalRateRow } from './metal-rates.ts';
import type { PlanNavRow } from './plans.ts';
import type { FundCatalogResponse, FundHistoryResponse } from './mufap.ts';

export type PublicCall = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

export function createPublicData(call: PublicCall): PublicData {
  return {
    async market(tickers) {
      const parts = await Promise.all(
        chunks(tickers, 100).map((part) =>
          call<PublicDataResponse>(
            `/api/public-data?tickers=${encodeURIComponent(part.join(','))}`,
          ),
        ),
      );
      return {
        tickers,
        quoteRows: parts.flatMap((p) => p.quoteRows),
        announcements: parts.flatMap((p) => p.announcements),
        faceValues: Object.assign({}, ...parts.map((p) => p.faceValues)),
        corporateActions: parts.flatMap((p) => p.corporateActions ?? []),
      };
    },
    async companies(tickers): Promise<CompanyLookup[]> {
      const parts = await Promise.all(
        chunks(tickers, 50).map((part) =>
          call<CompaniesResponse>(
            `/api/companies?tickers=${encodeURIComponent(part.join(','))}`,
          ),
        ),
      );
      return parts.flatMap((p) => p.companies);
    },
    async metalRates() {
      return (await call<{ rates: MetalRateRow[] }>('/api/public-data/metals'))
        .rates;
    },
    funds: () => call<FundCatalogResponse>('/api/public-data/funds'),
    async planNavs() {
      return (await call<{ navs: PlanNavRow[] }>('/api/public-data/plan-navs'))
        .navs;
    },
    async trackFunds(mufapIds) {
      await call('/api/public-data/funds', 'POST', { mufapIds });
    },
    fundHistory: (mufapId) =>
      call<FundHistoryResponse>(
        `/api/public-data/funds?fund=${encodeURIComponent(mufapId)}`,
      ),
    async requestLookup(tickers) {
      for (const part of chunks(tickers, 25))
        await call('/api/companies', 'POST', { tickers: part });
    },
  };
}
