// Runs the shared PSX-announcement bookkeeping when the portfolio loads on the phone, so expected dividends
// and payout alerts appear without the web app being opened. Verified face values come with the portfolio response
// (percentage payouts without one get no calculated amount rather than an assumed Rs 10). Best effort: any failure leaves the loaded data as is.
import type { PortfolioResponse } from '../../../lib/api-types.ts';
import { syncAutoDividends } from '../../../lib/dividend-sync.ts';

/** Where the sync saves and reloads: the unlocked vault on the phone (nothing readable goes to a server). */
export type SyncIo = {
  /** Saves the new version at `revision`; resolves `{ conflict: true }` when another device saved first. */
  save: (portfolio: PortfolioResponse['portfolio'], revision: number) => Promise<{ revision: number } | { conflict: true }>;
  reload: () => Promise<{ portfolio: PortfolioResponse['portfolio']; revision: number } | null>;
};

/** Returns the loaded portfolio, updated with whatever the sync saved or the reload after a conflict found. */
export async function syncAnnouncementsOnLoad(
  io: SyncIo,
  data: PortfolioResponse,
  options: { now?: () => string; asOf?: string } = {},
): Promise<PortfolioResponse> {
  const announcements = data.announcements ?? [];
  try {
    const result = await syncAutoDividends({ portfolio: data.portfolio, revision: data.revision }, announcements, io, {
      ...options,
      faceValues: data.faceValues ?? {},
    });
    return result.portfolio === data.portfolio ? data : { ...data, portfolio: result.portfolio, revision: result.revision };
  } catch {
    return data;
  }
}
