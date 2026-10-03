// Pure helpers for the payout push notifier (scripts/psx-payout-scrape.mjs).
//
// Privacy: portfolios are end-to-end encrypted, so the scraper cannot know who holds what and never tries to.
// A batch of newly seen PSX announcements produces ONE generic message per registered device. It names no
// ticker, amount or holding; the app opens, unlocks its vault, and decides locally what is relevant.
import type { PayoutAnnouncement } from './psx-payouts.ts';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: { kind: 'market-update' };
  channelId: string;
  sound: 'default';
};

const TOKEN = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,}\]$/;
export const isExpoPushToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

export const announcementKey = (r: { ticker: string; bookClosureStart: string; announcedOn: string; kind: string }) =>
  `${r.ticker}|${r.bookClosureStart}|${r.announcedOn}|${r.kind}`;

/**
 * Announcements worth a push: new since the last scrape, for tickers we had already scraped before.
 * A ticker with no stored rows is being seen for the first time, so its history is not announced.
 */
export function newAnnouncements(rows: PayoutAnnouncement[], knownKeys: Set<string>, knownTickers: Set<string>): PayoutAnnouncement[] {
  return rows.filter((r) => knownTickers.has(r.ticker) && !knownKeys.has(announcementKey(r)));
}

export const GENERIC_PUSH = {
  title: 'PSX market update',
  body: 'New payout announcements are available. Open Sipwise to see what applies to you.',
} as const;

/** One identical, content-free message per distinct valid token, or none when nothing is new. */
export function buildGenericPush(announcements: PayoutAnnouncement[], tokens: Iterable<string>): PushMessage[] {
  if (!announcements.length) return [];
  const seen = new Set<string>();
  const messages: PushMessage[] = [];
  for (const token of tokens) {
    if (!isExpoPushToken(token) || seen.has(token)) continue;
    seen.add(token);
    messages.push({ to: token, ...GENERIC_PUSH, data: { kind: 'market-update' }, channelId: 'dividends', sound: 'default' });
  }
  return messages;
}
