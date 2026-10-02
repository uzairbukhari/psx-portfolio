import {
  autoDividendId,
  entitlementDate,
  money,
  round,
  sharesHeldOn,
  type AppNotification,
  type Dividend,
  type Portfolio,
} from './portfolio.ts';
import type { PayoutAnnouncement } from './psx-payouts.ts';
import { faceValueFor, type FaceValueEvidence } from './face-values.ts';

export const MAX_NOTIFICATIONS = 200;
/** Announcements older than this with a finished book closure are history, not news. */
const RECENT_DAYS = 30;

const shiftDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** One "recorded" notification per dividend booked (auto, manual or CDC). */
export function dividendNotifications(
  dividends: Dividend[],
  now: string,
): AppNotification[] {
  return dividends.map((d) => ({
    id: `div:${d.externalId ?? d.id}`,
    at: now,
    kind: 'dividend-recorded',
    ticker: d.ticker,
    title: d.source === 'auto' ? `${d.ticker} dividend expected` : `${d.ticker} dividend recorded`,
    body:
      `${money(d.netAmount ?? d.grossAmount ?? 0)}${d.netAmount === undefined ? ' gross' : ' net'}` +
      ` for ${d.date}` +
      (d.source === 'auto'
        ? ' — booked automatically from the PSX announcement as an expected dividend; confirm it once the payment arrives.'
        : d.source === 'import'
          ? ' — imported from CDC.'
          : ' — entered manually.'),
    read: false,
  }));
}

/**
 * News about PSX payouts for held companies that the ledger has not been told
 * about yet: cash dividends still ahead of book closure (with the amount you
 * would receive) and bonus / right announcements, which are never booked
 * automatically. Cash announcements already past book closure are covered by
 * the "recorded" notification, so they are skipped here.
 */
export function announcementNotifications(
  p: Portfolio,
  announcements: PayoutAnnouncement[],
  asOf: string,
  now: string,
  faceValueEvidence: Record<string, FaceValueEvidence[]> = {},
): AppNotification[] {
  const known = new Set((p.notifications ?? []).map((n) => n.id));
  const companies = new Map(p.companies.map((c) => [c.ticker, c]));
  const cutoff = shiftDays(asOf, -RECENT_DAYS);
  const out: AppNotification[] = [];
  for (const a of announcements) {
    if (!companies.has(a.ticker)) continue;
    const id = `ann:${autoDividendId(a)}:${a.kind}`;
    if (known.has(id)) continue;
    const upcoming = a.bookClosureStart > asOf;
    if (!upcoming && (a.announcedOn < cutoff || a.kind === 'cash')) continue;
    const shares = sharesHeldOn(
      p,
      a.ticker,
      upcoming ? asOf : entitlementDate(a.bookClosureStart),
    );
    if (shares <= 0) continue;
    const closure = `book closure ${a.bookClosureStart}${a.bookClosureEnd !== a.bookClosureStart ? ' to ' + a.bookClosureEnd : ''}`;
    let title: string, body: string;
    if (a.kind === 'cash') {
      // A percentage of face value without a known face value has no amount: say so instead of guessing.
      const faceValue = a.perShareRs === null && a.percent !== null ? faceValueFor(companies.get(a.ticker), faceValueEvidence[a.ticker], entitlementDate(a.bookClosureStart)) : null;
      const perShare = a.perShareRs ?? (a.percent === null || faceValue === null ? null : round((a.percent / 100) * faceValue));
      title = `${a.ticker} announced a cash dividend`;
      body =
        perShare === null || !(perShare > 0)
          ? `${a.details}; ${closure}. The amount depends on the face value of ${a.ticker}, which is not confirmed yet, so no amount is calculated. Confirm the face value in Dividend sync or the company settings.`
          : `${a.details}, Rs ${perShare}/share; ${closure}. About ${money(round(perShare * shares))} on ${shares} shares if you still hold them on ${entitlementDate(a.bookClosureStart)} — it is recorded automatically after book closure starts.`;
    } else {
      title = `${a.ticker} announced a ${a.kind === 'bonus' ? 'bonus issue' : 'right issue'}`;
      body = `${a.details}; ${closure}. Not recorded automatically — add the resulting shares to your ledger yourself.`;
    }
    out.push({ id, at: now, kind: 'payout-announced', ticker: a.ticker, title, body, read: false });
  }
  return out;
}

/** Newest first, de-duplicated by id, capped (mutates and returns `p`). */
export function addNotifications(p: Portfolio, items: AppNotification[]) {
  const seen = new Set((p.notifications ?? []).map((n) => n.id));
  const fresh = items.filter((n) => !seen.has(n.id) && seen.add(n.id));
  p.notifications = [...fresh, ...(p.notifications ?? [])].slice(0, MAX_NOTIFICATIONS);
  return p;
}
