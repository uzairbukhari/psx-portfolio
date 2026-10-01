// Pure helpers for the dividend push notifier (scripts/psx-payout-scrape.mjs).
import type { PayoutAnnouncement } from './psx-payouts.ts';

export type PushRecipient = { email: string; token: string; tickers: Set<string> };
export type PushMessage = { to: string; title: string; body: string; data: { ticker: string }; channelId: string; sound: 'default' };

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

const describe = (r: PayoutAnnouncement) => {
  if (r.kind === 'cash') return r.perShareRs !== null ? `Rs ${r.perShareRs} per share` : r.percent !== null ? `${r.percent}% cash dividend` : 'cash dividend';
  if (r.kind === 'bonus') return r.percent !== null ? `${r.percent}% bonus shares` : 'bonus shares';
  return r.percent !== null ? `${r.percent}% right shares` : 'right shares';
};

export function buildPushMessages(announcements: PayoutAnnouncement[], recipients: PushRecipient[]): PushMessage[] {
  const messages: PushMessage[] = [];
  const seen = new Set<string>();
  for (const r of announcements) {
    for (const who of recipients) {
      const dedupe = `${who.token}|${announcementKey(r)}`;
      if (!who.tickers.has(r.ticker) || !isExpoPushToken(who.token) || seen.has(dedupe)) continue;
      seen.add(dedupe);
      messages.push({
        to: who.token,
        title: `${r.ticker} announced a payout`,
        body: `${describe(r)}. Book closure starts ${r.bookClosureStart}.`,
        data: { ticker: r.ticker },
        channelId: 'dividends',
        sound: 'default',
      });
    }
  }
  return messages;
}
