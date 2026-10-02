// Historical cash-dividend review: which PSX announcements the ledger was entitled to, over an editable
// book-closure range, and what approving them as received does.
//
// This is deliberately separate from forward automatic tracking (`pendingAutoDividends` /
// `startDividendTracking`): nothing here runs in the background, nothing is added until the user approves
// rows, and an approved row is stored as a received `auto` dividend with the same announcement identity,
// so the load-time sync neither duplicates nor voids it.
import {
  amountsAgree,
  autoDividendId,
  dividendStatus,
  inPayoutWindow,
  round,
  sharesHeldOn,
  today,
  type Dividend,
  type DividendEntitlementBasis,
  type Portfolio,
  type Trade,
} from './portfolio.ts';
import { historicalEntitlement } from './psx-calendar.ts';
import { resolveFaceValue, type FaceValueEvidence } from './face-values.ts';
import type { PayoutAnnouncement } from './psx-payouts.ts';

export type IssueKind =
  | 'face-value' // percent-of-face-value rate with no confirmed face value
  | 'face-value-conflict' // the account's own face value disagrees with verified evidence for that date
  | 'ambiguous-match' // a recorded dividend could belong to this or another announcement
  | 'calendar' // cutoff depends on holidays that are not officially confirmed
  | 'trade-date' // a trade near the cutoff has an unconfirmed execution date
  | 'inferred-shares' // part of the entitled quantity is an assumed acquisition
  | 'corporate-action' // a price break suggests an unrecorded split or bonus
  | 'superseded'; // a later announcement replaces this one

export type Issue = {
  kind: IssueKind;
  message: string;
  /** `block` cannot be overridden here; `confirm` needs the user's explicit acknowledgement. */
  severity: 'block' | 'confirm';
};

export type CandidateState =
  | 'eligible' // would create a received entry
  | 'convert' // an expected PSX dividend already exists; approval marks it received
  | 'approved' // already received through this review or by hand
  | 'recorded' // a manual or CDC dividend already covers it
  | 'voided' // the user voided it; never offered again
  | 'not-held'; // no shares at the cutoff

export type DividendCandidate = {
  id: string;
  announcement: PayoutAnnouncement;
  entitlementDate: string;
  settlement: 'T+1' | 'T+2';
  calendarCertain: boolean;
  shares: number;
  perShare: number | null;
  rateSource: 'rupees' | 'percent-of-face-value';
  faceValue: number | null;
  /**
   * Where `faceValue` came from: `review` (typed or assumed in this review), `account` (the company's own
   * value), `verified` (dated evidence). Null when none could be stated.
   */
  faceValueSource: 'review' | 'account' | 'verified' | null;
  /** Why no face value could be stated (only when `faceValue` is null and the rate is a percentage). */
  faceValueGap: 'none' | 'before-coverage' | 'conflict' | null;
  gross: number | null;
  state: CandidateState;
  /** Existing dividend ids this row converts or is covered by. */
  existingIds: string[];
  issues: Issue[];
};

export type HistoryOptions = {
  from?: string;
  to?: string;
  /** Face values the user confirmed in the review, by ticker (persisted on approval). */
  faceValues?: Record<string, number>;
  /** Verified, dated face-value evidence from the shared company directory, by ticker. */
  faceValueEvidence?: Record<string, FaceValueEvidence[]>;
};

export type HistoryPlan = {
  from: string;
  to: string;
  candidates: DividendCandidate[];
  /** Tickers with suspected unrecorded corporate actions. */
  corporateActions: CorporateActionSuspect[];
};

export type CorporateActionSuspect = { ticker: string; from: { date: string; price: number }; to: { date: string; price: number } };

const isReal = (t: Trade) => !t.voided && t.price !== null && t.kind !== 'opening' && !t.inferred;

/**
 * Tickers whose consecutive trade prices jump by a factor of two or more with no recorded split between
 * them: usually a split or bonus issue the ledger does not know about. A heuristic, so it only asks for
 * confirmation; it never changes holdings.
 */
export function suspectedCorporateActions(p: Portfolio): CorporateActionSuspect[] {
  const out: CorporateActionSuspect[] = [];
  for (const company of p.companies) {
    const trades = p.trades.filter((t) => t.ticker === company.ticker && isReal(t)).sort((a, b) => a.date.localeCompare(b.date));
    const splits = (p.stockSplits ?? []).filter((s) => !s.voided && s.ticker === company.ticker);
    for (let i = 1; i < trades.length; i++) {
      const [a, b] = [trades[i - 1], trades[i]];
      const ratio = b.price! / a.price!;
      if ((ratio >= 2 || ratio <= 0.5) && !splits.some((s) => s.date >= a.date && s.date <= b.date)) {
        out.push({ ticker: company.ticker, from: { date: a.date, price: a.price! }, to: { date: b.date, price: b.price! } });
        break;
      }
    }
  }
  return out;
}

/** First date any shares of the ticker were held, or null. */
export function firstHeldDate(p: Portfolio, ticker: string): string | null {
  const dates = p.trades.filter((t) => t.ticker === ticker && !t.voided && t.kind !== 'sell').map((t) => t.date).sort();
  return dates[0] ?? null;
}

/** Earliest holding date across the ledger: the default start of the review range. */
export function earliestHoldingDate(p: Portfolio): string | null {
  const dates = p.companies.map((c) => firstHeldDate(p, c.ticker)).filter((d): d is string => d !== null).sort();
  return dates[0] ?? null;
}

/** Tickers worth refreshing: every company with active trade history, sold-out ones included. */
export function historicalTickers(p: Portfolio): string[] {
  return [...new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker))].filter((t) => p.companies.some((c) => c.ticker === t)).sort();
}

const perShareOf = (a: PayoutAnnouncement, faceValue: number | null): number | null => {
  if (a.perShareRs !== null) return a.perShareRs > 0 ? a.perShareRs : null;
  if (a.percent === null || faceValue === null) return null;
  const value = round((a.percent / 100) * faceValue);
  return value > 0 ? value : null;
};

function sharesWithout(p: Portfolio, predicate: (t: Trade) => boolean, ticker: string, date: string) {
  const copy: Portfolio = { ...p, trades: p.trades.filter((t) => !predicate(t)) };
  try {
    return sharesHeldOn(copy, ticker, date);
  } catch {
    return 0;
  }
}

export function planHistoricalDividends(
  p: Portfolio,
  announcements: PayoutAnnouncement[],
  options: HistoryOptions = {},
): HistoryPlan {
  const from = options.from ?? earliestHoldingDate(p) ?? today();
  const to = options.to ?? today();
  const suspects = suspectedCorporateActions(p);
  const companies = new Map(p.companies.map((c) => [c.ticker, c]));
  const dividends = p.dividends ?? [];
  const byExternal = new Map(dividends.filter((d) => d.externalId).map((d) => [d.externalId!, d]));
  const recorded = dividends.filter((d) => !d.voided && d.source !== 'auto');

  // Latest announcement wins for one book closure (amended or re-announced payouts).
  const cash = announcements.filter((a) => a.kind === 'cash' && companies.has(a.ticker) && a.bookClosureStart >= from && a.bookClosureStart <= to);
  const groups = new Map<string, PayoutAnnouncement[]>();
  for (const a of cash) groups.set(`${a.ticker}|${a.bookClosureStart}`, [...(groups.get(`${a.ticker}|${a.bookClosureStart}`) ?? []), a]);
  const newest = new Map<string, PayoutAnnouncement>();
  for (const [key, list] of groups) newest.set(key, [...list].sort((x, y) => y.announcedOn.localeCompare(x.announcedOn))[0]);

  const candidates: DividendCandidate[] = [];
  for (const a of cash) {
    const company = companies.get(a.ticker)!;
    const id = autoDividendId(a);
    const entitlement = historicalEntitlement(a.bookClosureStart);
    const rateSource = a.perShareRs !== null ? 'rupees' : 'percent-of-face-value';
    // Precedence: a value chosen in this review, then the account's own value, then verified dated evidence.
    const reviewed = options.faceValues?.[a.ticker];
    const verified = rateSource === 'percent-of-face-value' ? resolveFaceValue(options.faceValueEvidence?.[a.ticker], entitlement.date) : null;
    const faceValue = reviewed ?? company.faceValue ?? (verified?.status === 'verified' ? verified.faceValue : null);
    const faceValueSource: DividendCandidate['faceValueSource'] =
      reviewed !== undefined ? 'review' : company.faceValue !== undefined ? 'account' : verified?.status === 'verified' ? 'verified' : null;
    const faceValueGap: DividendCandidate['faceValueGap'] = faceValue === null && verified?.status === 'unresolved' ? verified.reason : null;
    const perShare = perShareOf(a, faceValue);
    let shares = 0;
    try {
      shares = sharesHeldOn(p, a.ticker, entitlement.date);
    } catch {
      shares = 0;
    }
    const issues: Issue[] = [];
    let state: CandidateState = shares > 0 ? 'eligible' : 'not-held';
    let existingIds: string[] = [];

    const winner = newest.get(`${a.ticker}|${a.bookClosureStart}`)!;
    const superseded = winner !== a && winner.announcedOn !== a.announcedOn;
    if (superseded)
      issues.push({ kind: 'superseded', severity: 'block', message: `Replaced by the announcement of ${winner.announcedOn} for the same book closure.` });

    const existing = byExternal.get(id);
    if (existing) {
      existingIds = [existing.id];
      if (existing.voided) state = 'voided';
      else if (dividendStatus(existing) === 'received') state = 'approved';
      else state = shares > 0 ? 'convert' : 'not-held';
    } else if (state === 'eligible' || state === 'not-held') {
      // A manual or CDC dividend inside the payout window may already be this payout.
      const gross = perShare === null ? null : round(perShare * shares);
      const near = recorded.filter(
        (d) => d.ticker === a.ticker && inPayoutWindow(d.date, a.bookClosureStart) && (d.source !== 'import' || (gross !== null && amountsAgree(d.grossAmount ?? 0, gross))),
      );
      if (near.length) {
        // Another candidate of the same ticker inside the same window competes for the same record.
        const rivals = cash.filter((c) => c !== a && c.ticker === a.ticker && inPayoutWindow(near[0].date, c.bookClosureStart));
        if (rivals.length && !byExternal.get(autoDividendId(rivals[0])))
          issues.push({
            kind: 'ambiguous-match', severity: 'block',
            message: `A recorded dividend dated ${near[0].date} could belong to this payout or to another ${a.ticker} payout. Void or correct that record in Activity, then sync again.`,
          });
        else {
          state = 'recorded';
          existingIds = near.map((d) => d.id);
        }
      }
    }

    if (percentNeedsFace(a, faceValue))
      issues.push({
        kind: 'face-value', severity: 'confirm',
        message:
          faceValueGap === 'conflict'
            ? `PSX quotes ${a.percent}% of face value, but sources disagree about the face value of ${a.ticker}. Enter the correct one.`
            : faceValueGap === 'before-coverage'
              ? `PSX quotes ${a.percent}% of face value. The verified face value of ${a.ticker} only covers later dates, so it is not applied to this earlier payout. Confirm the face value that applied then.`
              : `PSX quotes ${a.percent}% of face value and no verified face value is on file for ${a.ticker}. Enter it, or use Rs 10 if that is what you assume.`,
      });
    // The account's own value is kept, but a disagreement with verified evidence is surfaced, never silently resolved.
    if (reviewed === undefined && company.faceValue !== undefined && verified?.status === 'verified' && verified.faceValue !== company.faceValue && rateSource === 'percent-of-face-value')
      issues.push({ kind: 'face-value-conflict', severity: 'confirm', message: `Your face value for ${a.ticker} is Rs ${company.faceValue}, but ${verified.evidence.sourceUrl} shows Rs ${verified.faceValue} for this date. Your value is used; confirm to keep it.` });
    if (!entitlement.certain)
      issues.push({ kind: 'calendar', severity: 'confirm', message: `The cutoff (${entitlement.date}, ${entitlement.settlement}) depends on market holidays that are not officially confirmed.` });
    if (shares > 0) {
      const nearTrade = p.trades.find(
        (t) => !t.voided && t.ticker === a.ticker && t.dateCertainty === 'inferred' && !t.inferred && Math.abs(Date.parse(t.date) - Date.parse(entitlement.date)) <= 7 * 86_400_000,
      );
      if (nearTrade)
        issues.push({ kind: 'trade-date', severity: 'confirm', message: `A ${nearTrade.kind} on ${nearTrade.date} near the cutoff has an unconfirmed execution date; the holding may differ.` });
      const withoutAssumed = sharesWithout(p, (t) => !!t.inferred && !t.voided, a.ticker, entitlement.date);
      if (withoutAssumed !== shares)
        issues.push({ kind: 'inferred-shares', severity: 'confirm', message: `${shares - withoutAssumed} of the ${shares} shares come from an acquisition assumed for a sale, not from a broker record.` });
      const suspect = suspects.find((s) => s.ticker === a.ticker && entitlement.date >= s.from.date);
      if (suspect)
        issues.push({
          kind: 'corporate-action', severity: 'confirm',
          message: `${a.ticker} traded at Rs ${suspect.from.price} on ${suspect.from.date} and Rs ${suspect.to.price} on ${suspect.to.date} with no recorded split or bonus. Check for a corporate action that changes the share count.`,
        });
    }
    candidates.push({
      id, announcement: a, entitlementDate: entitlement.date, settlement: entitlement.settlement, calendarCertain: entitlement.certain,
      shares, perShare, rateSource, faceValue, faceValueSource, faceValueGap, gross: perShare === null ? null : round(perShare * shares), state, existingIds, issues,
    });
  }
  candidates.sort((x, y) => y.announcement.bookClosureStart.localeCompare(x.announcement.bookClosureStart) || x.announcement.ticker.localeCompare(y.announcement.ticker));
  return { from, to, candidates, corporateActions: suspects };
}

const percentNeedsFace = (a: PayoutAnnouncement, faceValue: number | null) => a.perShareRs === null && a.percent !== null && faceValue === null;

/** Can this row be approved at all? Confirmations the user has given are in `confirmed`. */
export function isSelectable(c: DividendCandidate, confirmed: ReadonlySet<string> = new Set()): boolean {
  if (c.state !== 'eligible' && c.state !== 'convert') return false;
  if (c.perShare === null || c.gross === null || c.shares <= 0) return false;
  return c.issues.every((issue) => issue.severity === 'confirm' && (confirmed.has(`${c.id}|${issue.kind}`) || confirmed.has(`${c.announcement.ticker}|${issue.kind}`)));
}

/** Rows that need nothing more from the user: what "select all resolved" ticks. */
export const isResolved = (c: DividendCandidate) => (c.state === 'eligible' || c.state === 'convert') && c.issues.length === 0 && c.perShare !== null && c.gross !== null;

/** Companies in the plan whose percentage payouts still lack a usable face value (rows the user could still act on). */
export function unresolvedFaceValueTickers(plan: HistoryPlan): string[] {
  const tickers = new Set<string>();
  for (const c of plan.candidates)
    if ((c.state === 'eligible' || c.state === 'convert') && c.shares > 0 && c.issues.some((i) => i.kind === 'face-value')) tickers.add(c.announcement.ticker);
  return [...tickers].sort();
}

/**
 * "Use Rs 10 for all unresolved companies": the review's face-value choices plus `value` for exactly the
 * companies still unresolved in this plan. Existing choices and every resolved company are left alone.
 */
export function assumeFaceValueForUnresolved(plan: HistoryPlan, current: Record<string, number>, value = 10) {
  const tickers = unresolvedFaceValueTickers(plan).filter((t) => current[t] === undefined);
  return { faceValues: { ...current, ...Object.fromEntries(tickers.map((t) => [t, value])) }, assumed: tickers };
}

export type ApprovalRequest = {
  /** Candidates exactly as the user saw them. */
  reviewed: { id: string; shares: number; perShare: number; gross: number }[];
  faceValues?: Record<string, number>;
  /** Tickers whose face value in `faceValues` is the review's "assume Rs 10" choice, not an entered or verified value. */
  assumedFaceValues?: readonly string[];
  /** Verified face-value evidence the review was prepared with. */
  faceValueEvidence?: Record<string, FaceValueEvidence[]>;
  confirmed?: ReadonlySet<string>;
  from?: string;
  to?: string;
  now?: string;
};
export type ApprovalResult =
  | { ok: true; portfolio: Portfolio; approved: string[]; converted: string[]; total: number }
  | { ok: false; reason: 'stale' | 'unresolved' | 'empty'; ids: string[]; message: string };

/**
 * Marks the reviewed rows received, freezing the calculated gross and its evidence. The review is re-planned
 * against the current ledger and announcements first; if any row's shares, rate or amount differs from what the
 * user saw, nothing is written and the user must review again.
 */
export function approveSelectedAsReceived(
  p: Portfolio,
  announcements: PayoutAnnouncement[],
  request: ApprovalRequest,
): ApprovalResult {
  if (!request.reviewed.length) return { ok: false, reason: 'empty', ids: [], message: 'Select at least one dividend.' };
  const plan = planHistoricalDividends(p, announcements, { from: request.from, to: request.to, faceValues: request.faceValues, faceValueEvidence: request.faceValueEvidence });
  const byId = new Map(plan.candidates.map((c) => [c.id, c]));
  const stale: string[] = [], unresolved: string[] = [];
  for (const seen of request.reviewed) {
    const now = byId.get(seen.id);
    if (!now || now.shares !== seen.shares || now.perShare !== seen.perShare || now.gross !== seen.gross) stale.push(seen.id);
    else if (!isSelectable(now, request.confirmed ?? new Set())) unresolved.push(seen.id);
  }
  if (stale.length)
    return { ok: false, reason: 'stale', ids: stale, message: 'Your holdings or the announcements changed since this list was prepared. Review the updated list.' };
  if (unresolved.length)
    return { ok: false, reason: 'unresolved', ids: unresolved, message: 'Some selected rows still need confirmation.' };

  const at = request.now ?? new Date().toISOString();
  const next = JSON.parse(JSON.stringify(p)) as Portfolio;
  next.dividends ??= [];
  const approved: string[] = [], converted: string[] = [];
  let total = 0;
  for (const seen of request.reviewed) {
    const c = byId.get(seen.id)!;
    const a = c.announcement;
    const company = next.companies.find((x) => x.ticker === a.ticker)!;
    // Only a value the user supplied or assumed in this review is kept on the account; verified evidence stays
    // in the shared directory and an existing account value is never replaced.
    if (c.rateSource === 'percent-of-face-value' && company.faceValue === undefined && c.faceValueSource === 'review' && c.faceValue !== null) {
      company.faceValue = c.faceValue;
      if (request.assumedFaceValues?.includes(a.ticker)) company.faceValueAssumed = true;
    }
    const entitlement: DividendEntitlementBasis = {
      shares: c.shares, perShare: c.perShare!, bookClosureEnd: a.bookClosureEnd, details: a.details.slice(0, 200), announcedOn: a.announcedOn,
      faceValue: c.rateSource === 'percent-of-face-value' ? c.faceValue : null, rateSource: c.rateSource, certain: c.calendarCertain && c.issues.length === 0,
    };
    const note =
      `PSX ${a.details}${a.period ? ', ' + a.period : ''}; book closure ${a.bookClosureStart} to ${a.bookClosureEnd}; ${c.shares} shares held on ${c.entitlementDate} ` +
      `(${c.settlement} settlement). Approved as received by you on ${at.slice(0, 10)}: gross is the calculated entitlement, not a reported payment; payment date unknown; no tax recorded.`;
    const fields = {
      source: 'auto' as const, status: 'received' as const, paymentDateUnknown: true as const, receiptConfirmedAt: at,
      date: a.bookClosureStart, entitlementDate: c.entitlementDate, entitlementCertain: c.calendarCertain, perShare: c.perShare!, grossAmount: c.gross!,
      externalId: c.id, financialYear: a.period || undefined, entitlement, note: note.slice(0, 2000),
    };
    if (c.state === 'convert') {
      const target = next.dividends.find((d) => d.id === c.existingIds[0])!;
      Object.assign(target, fields);
      delete target.paymentDate;
      converted.push(c.id);
    } else {
      next.dividends.push({ id: `auto-${c.id}`, ticker: a.ticker, ...fields } as Dividend);
      approved.push(c.id);
    }
    total = round(total + c.gross!);
  }
  return { ok: true, portfolio: next, approved, converted, total };
}

