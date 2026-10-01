// Read / clear / filter operations on the notification list, with the same semantics as the web bell and
// notifications page (app/portfolio.tsx, app/notifications-view.tsx): clearing sets `clearedAt` (and marks
// the item read) instead of deleting it, so it stays in history and still de-dupes new announcements.
import { dividendStatus, type AppNotification, type Dividend, type Portfolio } from './portfolio.ts';

/** `inbox` is what the bell shows (not cleared); `all` is the full history including cleared items. */
export type NotificationFilter = 'inbox' | 'all' | 'unread' | 'cleared';

export const isUnread = (n: AppNotification) => !n.read && !n.clearedAt;

export function notificationCounts(list: AppNotification[]): Record<NotificationFilter, number> {
  return {
    inbox: list.filter((n) => !n.clearedAt).length,
    all: list.length,
    unread: list.filter(isUnread).length,
    cleared: list.filter((n) => n.clearedAt).length,
  };
}

/** Newest first, narrowed to a filter. "All" includes cleared items, as on the web history page; "inbox" leaves them out, as the bell does. */
export function filterNotifications(list: AppNotification[], filter: NotificationFilter): AppNotification[] {
  return list
    .filter((n) =>
      filter === 'unread' ? isUnread(n) : filter === 'cleared' ? Boolean(n.clearedAt) : filter === 'inbox' ? !n.clearedAt : true,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const patch = (list: AppNotification[], id: string, change: Partial<AppNotification>) =>
  list.map((n) => (n.id === id ? { ...n, ...change } : n));

export const setRead = (list: AppNotification[], id: string, read: boolean) => patch(list, id, { read });

/** Clears one item from the inbox: read, and kept in history. */
export const clearOne = (list: AppNotification[], id: string, at: string) =>
  list.map((n) => (n.id === id && !n.clearedAt ? { ...n, read: true, clearedAt: at } : n));

export const restoreOne = (list: AppNotification[], id: string) =>
  list.map((n) => {
    if (n.id !== id) return n;
    const { clearedAt: _cleared, ...rest } = n;
    return rest;
  });

/** Marks every item still in the inbox read (cleared ones are left as they are). */
export const markAllRead = (list: AppNotification[]) => list.map((n) => (n.clearedAt ? n : { ...n, read: true }));

/** Clears everything still in the inbox. */
export const clearAll = (list: AppNotification[], at: string) =>
  list.map((n) => (n.clearedAt ? n : { ...n, read: true, clearedAt: at }));

/** The only permanent removal: drops what was already cleared. */
export const deleteCleared = (list: AppNotification[]) => list.filter((n) => !n.clearedAt);

/**
 * The expected PSX dividend a notification is about, if it is still waiting to be marked received. Matches the
 * "recorded" alert (`div:<dividend id or externalId>`) and the announcement alert (`ann:<payout id>:cash`),
 * whose payout becomes the auto dividend once book closure starts.
 */
export function expectedDividendFor(p: Portfolio, n: Pick<AppNotification, 'id' | 'kind'>): Dividend | null {
  let key: string | null = null;
  if (n.kind === 'dividend-recorded' && n.id.startsWith('div:')) key = n.id.slice(4);
  else if (n.kind === 'payout-announced' && n.id.startsWith('ann:') && n.id.endsWith(':cash')) key = n.id.slice(4, -5);
  if (!key) return null;
  const found = (p.dividends ?? []).find((d) => !d.voided && (d.externalId ?? d.id) === key);
  return found && found.source === 'auto' && dividendStatus(found) === 'expected' ? found : null;
}
