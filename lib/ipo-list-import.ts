// Turns an IPO subscription/allotment export (`ipo-list.json`) into a reviewable import plan, and a plan into trades.
//
// Pure and deterministic: the review dialog re-runs planIpoListImport() after every decision, so the preview shows
// exactly what applyIpoListPlan() writes. Only rows that were actually allotted become trades; the price is what was
// really paid per share (amount paid minus any refund, over shares allotted), not the advertised offer price.
import type { HoldingChange } from './ahl-reconcile.ts';
import { withSplits } from './import-splits.ts';
import type { IpoLookup } from './ipo-offers.ts';
import { dateOK, holdings, today, validate, type Company, type Portfolio, type StockSplit, type Trade } from './portfolio.ts';

export type IpoAllotment = {
  appId: string;
  ticker: string;
  name: string;
  issueNumber: string;
  offerType: string;
  applied: number;
  allotted: number;
  amountPaid: number;
  refund: number;
  status: string;
  startDate: string;
  endDate: string;
};

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
function parseDate(value: unknown): string {
  const m = typeof value === 'string' ? /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim()) : null;
  const iso = m && MONTHS[m[2].toUpperCase()] ? `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : '';
  return iso && dateOK(iso) ? iso : '';
}
function amount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Reads `{data:[...]}` or a bare array of subscription rows. Throws a plain-language error for anything else. */
export function parseIpoList(raw: unknown): IpoAllotment[] {
  const obj = raw as { data?: unknown; dataCount?: unknown } | null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.data) ? (obj!.data as unknown[]) : null;
  if (!list || !list.length) throw new Error('Choose the IPO list JSON export (it has a "data" list of subscriptions).');
  if (!Array.isArray(raw) && obj?.dataCount !== undefined && Number(obj.dataCount) !== list.length)
    throw new Error(`The file says it has ${obj.dataCount} subscriptions but ${list.length} were found.`);
  const seen = new Set<string>();
  return list.map((value, index) => {
    const r = (value ?? {}) as Record<string, unknown>;
    const ticker = text(r.securitySymbol).toUpperCase();
    const appId = text(r.subscriptionAppId) || `${ticker}:${text(r.issueNumber)}`;
    const item: IpoAllotment = {
      appId, ticker, name: text(r.securityName) || ticker, issueNumber: text(r.issueNumber), offerType: text(r.offerTypeValue),
      applied: amount(r.numberOfSecuritiesApplied), allotted: amount(r.noOfSecuritiesSuccessful),
      amountPaid: amount(r.amountPayableOrPaid), refund: amount(r.refundAmount) || 0,
      status: text(r.status), startDate: parseDate(r.subscriptionStartDate), endDate: parseDate(r.subscriptionEndDate),
    };
    if (!/^[A-Z0-9]{2,12}$/.test(ticker) || !Number.isFinite(item.allotted) || !Number.isFinite(item.amountPaid) || !item.endDate)
      throw new Error(`IPO row ${index + 1} is missing its symbol, allotted quantity, amount or end date.`);
    if (!Number.isFinite(item.applied)) item.applied = item.allotted;
    if (seen.has(appId)) throw new Error(`IPO row ${index + 1} repeats subscription ${appId}.`);
    seen.add(appId);
    return item;
  });
}

export type IpoOutcome = 'allotted' | 'not-allotted' | 'pending';
export function ipoOutcome(item: Pick<IpoAllotment, 'status' | 'allotted'>): IpoOutcome {
  if (/not\s*(successful|allot)|unsuccessful|reject|cancel|fail/i.test(item.status) || item.allotted <= 0) return /pend|process|under|submitted|applied/i.test(item.status) ? 'pending' : 'not-allotted';
  if (/pend|process|under|submitted/i.test(item.status)) return 'pending';
  return /allot|success/i.test(item.status) ? 'allotted' : 'pending';
}

export type IpoRowStatus = 'new' | 'duplicate' | 'previously-removed' | 'ambiguous' | 'not-allotted' | 'pending';
export type IpoResolution = { action?: 'import' | 'skip'; shares?: number; date?: string };
export type IpoPlanRow = {
  item: IpoAllotment;
  externalId: string;
  status: IpoRowStatus;
  action: 'import' | 'skip';
  shares: number;
  price: number;
  date: string;
  dateInferred: boolean;
  flags: string[];
  candidates: { id: string; source: string; reason: string }[];
  /** Assumed acquisitions an earlier import made that this real allotment replaces. */
  supersedes: { id: string; shares: number }[];
  needsResolution: boolean;
};
export type IpoPlan = {
  rows: IpoPlanRow[];
  newCompanies: string[];
  splits: StockSplit[];
  holdingChanges: HoldingChange[];
  warnings: string[];
  blockers: string[];
  counts: { new: number; duplicate: number; ambiguous: number; skipped: number; imported: number };
};
export type IpoPlanOptions = { resolutions?: Record<string, IpoResolution>; ipo?: Record<string, IpoLookup | undefined>; splits?: StockSplit[] };

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / dayMs;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const ipoExternalId = (item: Pick<IpoAllotment, 'appId'>) => `ipo:${item.appId}`;
const baseTradeId = (item: Pick<IpoAllotment, 'appId'>) => `ipo-b-${item.appId}`;

export function planIpoListImport(original: Portfolio, items: IpoAllotment[], options: IpoPlanOptions = {}): IpoPlan {
  const portfolio = withSplits(original, options.splits);
  const resolutions = options.resolutions ?? {};
  const active = portfolio.trades.filter((t) => !t.voided);
  const byExternal = new Set(active.filter((t) => t.source === 'ipo').map((t) => t.externalId));
  const removed = new Set(portfolio.trades.filter((t) => t.voided && t.source === 'ipo').map((t) => t.externalId));
  const pool = active.filter((t) => t.kind === 'buy' && t.source !== 'ipo' && !t.inferred);
  const inferred = active.filter((t) => t.inferred && t.kind === 'buy');
  const consumedInferred = new Set<string>();
  const rows: IpoPlanRow[] = [];

  for (const item of items) {
    const externalId = ipoExternalId(item);
    const res = resolutions[externalId] ?? {};
    const outcome = ipoOutcome(item);
    const flags: string[] = [];
    const shares = res.shares !== undefined && Number.isSafeInteger(res.shares) && res.shares > 0 ? res.shares : item.allotted;
    const net = item.amountPaid - item.refund;
    const price = shares > 0 ? round4(net / shares) : 0;
    const found = options.ipo?.[item.ticker];
    // Only hand-checked offer evidence is allowed to move a date or raise a warning.
    const lookup = found?.status === 'found' && found.verification === 'curated' ? found : undefined;
    const official = lookup?.status === 'found' && lookup.allotmentDate && lookup.allotmentDate >= item.endDate ? lookup.allotmentDate : '';
    const userDate = res.date && dateOK(res.date) ? res.date : '';
    const date = userDate || official || item.endDate;
    const dateInferred = !userDate && !official;
    const base = { item, externalId, shares, price, date, dateInferred, flags, candidates: [] as IpoPlanRow['candidates'], supersedes: [] as IpoPlanRow['supersedes'] };

    if (outcome !== 'allotted') {
      rows.push({ ...base, status: outcome, action: 'skip', needsResolution: false,
        flags: [outcome === 'pending' ? 'Not final yet: import this list again once the allotment is published.' : item.refund > 0 ? `Not allotted; Rs ${item.refund.toFixed(2)} refunded.` : 'Not allotted.'] });
      continue;
    }
    if (byExternal.has(externalId)) { rows.push({ ...base, status: 'duplicate', action: 'skip', needsResolution: false }); continue; }
    if (removed.has(externalId)) { rows.push({ ...base, status: 'previously-removed', action: res.action ?? 'skip', needsResolution: false }); continue; }

    if (net <= 0 || !Number.isFinite(price) || price <= 0) flags.push('The amount paid minus the refund is not positive, so no price can be worked out.');
    if (item.status.toLowerCase().includes('partial') && item.allotted === item.applied && item.refund === 0)
      flags.push('Marked partial, but you received everything you applied for and nothing was refunded. Check the quantity.');
    if (item.allotted > item.applied) flags.push('More shares allotted than applied for. Check the quantity.');
    if (lookup?.status === 'found' && lookup.offerPrice > 0 && Math.abs(lookup.offerPrice - price) / lookup.offerPrice > 0.01)
      flags.push(`Official offer price is Rs ${lookup.offerPrice}, but you paid Rs ${price} per share.`);
    if (date > today()) flags.push('The allotment date is in the future.');

    const similar = pool.filter((t) => t.ticker === item.ticker && t.shares === shares && daysBetween(t.date, date) <= 30);
    let status: IpoRowStatus = 'new';
    let action: 'import' | 'skip' = res.action ?? 'import';
    let needsResolution = false;
    const candidates: IpoPlanRow['candidates'] = [];
    if (similar.length) {
      status = 'ambiguous';
      action = res.action ?? 'skip';
      needsResolution = !res.action;
      for (const t of similar) candidates.push({ id: t.id, source: t.source ?? 'manual', reason: `Your ${t.source ?? 'manual'} buy of ${t.shares} on ${t.date} at Rs ${t.price} may be this allotment.` });
    }
    const supersedes = action === 'import'
      ? inferred.filter((t) => t.ticker === item.ticker && t.shares <= shares && !consumedInferred.has(t.id)).map((t) => ({ id: t.id, shares: t.shares }))
      : [];
    if (action === 'import') for (const s of supersedes) consumedInferred.add(s.id);
    rows.push({ ...base, flags, status, action, candidates, supersedes, needsResolution });
  }

  const importing = rows.filter((r) => r.action === 'import');
  const known = new Set(portfolio.companies.map((c) => c.ticker));
  const newCompanies = [...new Set(importing.map((r) => r.item.ticker))].filter((t) => !known.has(t)).sort();
  const blockers: string[] = [];
  const warnings: string[] = [];
  let holdingChanges: HoldingChange[] = [];
  const tickers = [...new Set(importing.map((r) => r.item.ticker))];
  const after = materializeIpo(portfolio, importing, newCompanies);
  try {
    validate(after);
    const before = holdings(original);
    const now = holdings(after);
    holdingChanges = tickers
      .map((ticker) => {
        const b = before.find((h) => h.ticker === ticker);
        const a = now.find((h) => h.ticker === ticker);
        return { ticker, beforeShares: b?.shares ?? 0, afterShares: a?.shares ?? 0, beforeCostKnown: b ? b.cost !== null : true, afterCostKnown: a ? a.cost !== null : true };
      })
      .filter((c) => c.beforeShares !== c.afterShares || c.beforeCostKnown !== c.afterCostKnown);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const unresolved = rows.filter((r) => r.needsResolution).length;
  if (unresolved) blockers.push(`${unresolved} row${unresolved === 1 ? '' : 's'} need your decision before importing.`);
  const bad = importing.filter((r) => r.price <= 0);
  if (bad.length) blockers.push(`${bad.map((r) => r.item.ticker).join(', ')}: no price could be worked out. Untick the row or correct the quantity.`);
  if (importing.some((r) => r.dateInferred)) warnings.push('Where the official allotment date is unknown, the subscription end date is used. Edit the date if you know the exact day.');
  return {
    rows, newCompanies, splits: options.splits ?? [], holdingChanges, warnings, blockers,
    counts: {
      new: rows.filter((r) => r.status === 'new').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
      ambiguous: rows.filter((r) => r.status === 'ambiguous').length,
      skipped: rows.filter((r) => r.status === 'not-allotted' || r.status === 'pending').length,
      imported: importing.length,
    },
  };
}

function materializeIpo(portfolio: Portfolio, rows: IpoPlanRow[], newCompanies: string[]): Portfolio {
  const copy = JSON.parse(JSON.stringify(portfolio)) as Portfolio;
  // An allotment imported again after its trade was removed keeps the voided trade as history, so it needs a fresh id.
  const ids = new Map<string, string>();
  for (const row of rows) {
    let id = baseTradeId(row.item);
    for (let n = 2; copy.trades.some((t) => t.id === id); n++) id = `${baseTradeId(row.item)}-${n}`;
    ids.set(row.externalId, id);
  }
  const superseded = new Map<string, string>();
  for (const row of rows) for (const s of row.supersedes) superseded.set(s.id, ids.get(row.externalId)!);
  for (const trade of copy.trades) if (superseded.has(trade.id)) { trade.voided = true; trade.supersededBy = superseded.get(trade.id); }
  for (const ticker of newCompanies)
    copy.companies.push({
      ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '',
      note: 'Added from an IPO allotment import. Review company details before any new SIP allocation.',
    } satisfies Company);
  for (const row of rows) {
    const { item } = row;
    copy.trades.push({
      id: ids.get(row.externalId)!, ticker: item.ticker, kind: 'buy', date: row.date, shares: row.shares, price: row.price, fees: 0,
      month: row.date.slice(0, 7),
      note: `IPO allotment: ${item.name}${item.offerType ? ` (${item.offerType})` : ''}${item.issueNumber ? `, issue ${item.issueNumber}` : ''}. Paid Rs ${item.amountPaid.toFixed(2)}${item.refund ? `, refunded Rs ${item.refund.toFixed(2)}` : ''}.`.slice(0, 600),
      source: 'ipo', externalId: ipoExternalId(item),
      dateCertainty: row.dateInferred ? 'inferred' : 'confirmed',
      netCash: Math.round((item.amountPaid - item.refund) * 100) / 100,
    } satisfies Trade);
  }
  return copy;
}

/** The portfolio after the plan. Throws while the plan has blockers. */
export function applyIpoListPlan(portfolio: Portfolio, plan: IpoPlan): Portfolio {
  if (plan.blockers.length) throw new Error(plan.blockers[0]);
  const next = materializeIpo(withSplits(portfolio, plan.splits), plan.rows.filter((r) => r.action === 'import'), plan.newCompanies);
  validate(next);
  return next;
}

export const ipoPlanIsNoop = (plan: IpoPlan) => plan.rows.every((r) => r.action === 'skip') && !plan.splits.length && !plan.newCompanies.length;
