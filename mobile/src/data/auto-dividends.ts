// Runs the shared PSX-announcement bookkeeping when the portfolio loads on the phone, so expected dividends
// and payout alerts appear without the web app being opened. Verified face values come with the portfolio response
// (percentage payouts without one get no calculated amount rather than an assumed Rs 10). Best effort: any failure leaves the loaded data as is.
import type { PortfolioResponse, SavePortfolioRequest, SavePortfolioResponse } from '../../../lib/api-types.ts';
import { syncAutoDividends } from '../../../lib/dividend-sync.ts';
import { ApiRequestError } from '../api/client.ts';

type Api = {
  get: <T>(path: string) => Promise<T>;
  put: <T>(path: string, data: unknown) => Promise<T>;
};

/** Returns the loaded portfolio, updated with whatever the sync saved or the reload after a 409 found. */
export async function syncAnnouncementsOnLoad(
  api: Api,
  data: PortfolioResponse,
  options: { now?: () => string; asOf?: string } = {},
): Promise<PortfolioResponse> {
  const announcements = data.announcements ?? [];
  try {
    const result = await syncAutoDividends({ portfolio: data.portfolio, revision: data.revision }, announcements, {
      save: async (portfolio, revision) => {
        try {
          const saved = await api.put<SavePortfolioResponse>('/api/portfolio', { portfolio, revision } satisfies SavePortfolioRequest);
          return { revision: saved.revision };
        } catch (e) {
          if (e instanceof ApiRequestError && e.status === 409) return { conflict: true };
          throw e;
        }
      },
      reload: async () => {
        const fresh = await api.get<PortfolioResponse>('/api/portfolio');
        return fresh?.portfolio ? { portfolio: fresh.portfolio, revision: fresh.revision } : null;
      },
    }, { ...options, faceValues: data.faceValues ?? {} });
    return result.portfolio === data.portfolio ? data : { ...data, portfolio: result.portfolio, revision: result.revision };
  } catch {
    return data;
  }
}
