// Automatic dividend bookkeeping that needs no review screen:
//  - estimated payment dates, so received dividends land in the right tax year;
//  - expected PSX dividends become received once their estimated payment date has passed (the user can edit the
//    amount or date, or void the record when the money never arrived);
//  - past payouts the ledger was entitled to are added as received when nothing about them is uncertain; anything
//    with an issue (no face value, unsure holiday calendar, possible split) stays in the review list.
// Every row added here carries a batch id so one tap can undo the whole run. Pure and deterministic.
import {
  approveSelectedAsReceived,
  earliestHoldingDate,
  isResolved,
  planHistoricalDividends,
} from './dividend-history.ts';
import { autoDividendId, dividendStatus, type Dividend, type Portfolio } from './portfolio.ts';
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { FaceValueEvidence } from './face-values.ts';

/** Cash usually reaches CDC accounts within about two weeks of book closure. */
export const PAYMENT_LAG_WEEKDAYS = 10;

/** Book closure end plus ten weekdays (market holidays are not known that far ahead, so they are ignored). */
export function estimatePaymentDate(bookClosureEnd: string): string {
  const d = new Date(bookClosureEnd + 'T00:00:00Z');
  for (let left = PAYMENT_LAG_WEEKDAYS; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}


export type SettleResult = { received: Dividend[]; dated: Dividend[] };

/**
 * Mutates `p`: expected automatic dividends whose estimated payment date has passed become received with that
 * estimated date, and received ones that only said "date unknown" get an estimated date too (the gap that kept
 * them out of every tax year). `announcements` give the real book closure end; without one the entitlement
 * basis, then the book closure start, is used.
 */
export function settleEstimatedPayments(p: Portfolio, announcements: PayoutAnnouncement[], asOf: string, batch: string, now: string): SettleResult {
  const closureEnd = new Map(announcements.map((a) => [autoDividendId(a), a.bookClosureEnd]));
  const out: SettleResult = { received: [], dated: [] };
  for (const d of p.dividends ?? []) {
    if (d.voided || d.source !== 'auto') continue;
    const estimate = estimatePaymentDate((d.externalId ? closureEnd.get(d.externalId) : undefined) ?? d.entitlement?.bookClosureEnd ?? d.date);
    if (estimate > asOf) continue;
    if (dividendStatus(d) === 'expected') {
      d.status = 'received';
      d.paymentDate = estimate;
      d.paymentDateEstimated = true;
      d.autoBatch = batch;
      d.note = `${d.note.replace(/ Expected, not yet received\.$/, '')} Marked received automatically on ${now.slice(0, 10)} (estimated payment date ${estimate}); edit it if the real date or amount differs, or void it if the money never arrived.`.slice(0, 2000);
      out.received.push(d);
    } else if (d.paymentDateUnknown && d.paymentDate === undefined) {
      delete d.paymentDateUnknown;
      d.paymentDate = estimate;
      d.paymentDateEstimated = true;
      out.dated.push(d);
    }
  }
  return out;
}

/**
 * Past payouts (book closure before dividend tracking began) the ledger was entitled to and that need nothing
 * from the user, added as received with an estimated payment date. Returns the added rows. Mutates `p`.
 */
export function addResolvedHistory(
  p: Portfolio,
  announcements: PayoutAnnouncement[],
  evidence: Record<string, FaceValueEvidence[]>,
  asOf: string,
  batch: string,
  now: string,
): Dividend[] {
  const from = earliestHoldingDate(p);
  if (!from || !p.dividendTrackingFrom) return [];
  const plan = planHistoricalDividends(p, announcements, { from, to: asOf, faceValueEvidence: evidence });
  const rows = plan.candidates.filter(
    (c) => c.state === 'eligible' && isResolved(c) && c.announcement.bookClosureStart < p.dividendTrackingFrom! && estimatePaymentDate(c.announcement.bookClosureEnd) <= asOf,
  );
  if (!rows.length) return [];
  const result = approveSelectedAsReceived(p, announcements, {
    reviewed: rows.map((c) => ({ id: c.id, shares: c.shares, perShare: c.perShare!, gross: c.gross! })),
    faceValueEvidence: evidence, from, to: asOf, now,
  });
  if (!result.ok) return [];
  const byId = new Map(result.portfolio.dividends!.map((d) => [d.id, d]));
  const added: Dividend[] = [];
  for (const c of rows) {
    const target = byId.get(`auto-${c.id}`);
    if (!target) continue;
    const estimate = estimatePaymentDate(c.announcement.bookClosureEnd);
    delete target.paymentDateUnknown;
    target.paymentDate = estimate;
    target.paymentDateEstimated = true;
    target.autoBatch = batch;
    target.note = target.note.replace('payment date unknown; no tax recorded.', `payment date estimated (${estimate}); no tax recorded. Added automatically: edit it if it differs, or void it if you did not receive it.`).slice(0, 2000);
    added.push(target);
  }
  p.dividends = result.portfolio.dividends;
  return added;
}

/** Voids every dividend an automatic run added (the undo for one batch). Mutates `p`; returns how many. */
export function undoAutoBatch(p: Portfolio, batch: string): number {
  let n = 0;
  for (const d of p.dividends ?? []) if (d.autoBatch === batch && !d.voided) { d.voided = true; n++; }
  return n;
}
