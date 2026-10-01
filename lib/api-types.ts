// Request/response shapes of the JSON API, shared by the web app and the native
// apps. Types only (no runtime imports), so the mobile bundle can use this file
// directly. Routes use `satisfies` against these so the two cannot drift.
// Not yet covered: market-summary, recommendations and research/* (added with
// the screens that use them).
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { Portfolio, Quote } from './portfolio.ts';
import type { PricePoint } from './price-history.ts';

// Mirrors lib/roles.ts (which imports the Workers runtime, so it can't be shared).
export type Role = 'super_admin' | 'user';

export type ApiError = { error: string };

export type MeResponse = {
  email: string;
  name: string | null;
  picture: string | null;
  role: Role;
};

/** DELETE /api/me body: the signed-in email, typed by the user, confirms the permanent deletion. */
export type DeleteAccountRequest = { confirm: string };
export type DeleteAccountResponse = { deleted: true };

export type MobileSignInRequest = {
  /** Google ID token from the native Google Sign-In SDK. */
  idToken: string;
  deviceName?: string;
  platform?: 'ios' | 'android';
};
export type MobileSignInResponse = {
  /** Send as `Authorization: Bearer <token>` on every API request. */
  token: string;
  user: MeResponse;
};

export type MobileSessionInfo = {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
};
export type MobileSessionsResponse = { sessions: MobileSessionInfo[] };

export type PortfolioResponse = {
  portfolio: Portfolio;
  revision: number;
  announcements: PayoutAnnouncement[];
};
/** PUT /api/portfolio body. A stale `revision` is answered with 409. */
export type SavePortfolioRequest = { portfolio: Portfolio; revision: number };
export type SavePortfolioResponse = { revision: number };

/** POST /api/quotes body: `{ tickers }` (optionally `?force=1`). */
export type QuotesResponse = {
  quotes: Record<string, Quote>;
  errors: string[];
  reasons: Record<string, string>;
  stale: Record<string, string>;
};

export type UsageResponse = { inputTokens: number; outputTokens: number; costUsd: number };

export type PriceHistoryResponse = {
  ticker: string;
  eod: PricePoint[];
  intraday: PricePoint[];
  eodFetchedAt: string | null;
  intradayFetchedAt: string | null;
};
export type PriceHistoryBatchResponse = {
  histories: Record<string, { eod: PricePoint[] }>;
};
