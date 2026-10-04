// Turns a parsed AHL Client Ledger into a reviewable import plan, and a plan into portfolio changes.
//
// planAhlLedgerImport() is pure and deterministic: the UI re-runs it after every correction or
// resolution, so the preview always shows exactly what applyAhlLedgerPlan() would write. Nothing here
// merges another broker's trades, and no statement row is dropped as a "duplicate" on equal cash or a
// shared voucher alone.
import { dateOK, holdings, saleShortfalls, validate, type Company, type Portfolio, type StockSplit, type Trade } from './portfolio.ts';
import { withSplits } from './import-splits.ts';
import type { StatementTrade, AhlLedgerStatement } from './ahl-ledger-pdf.ts';
import { priceAssumedAcquisition, type IpoLookup, type IpoPricing } from './ipo-offers.ts';

/** Reported vs recorded net cash per fill (currency rounding plus the 4-place component fees). */
const NET_TOLERANCE = 0.02;
const NEAR_DAYS = 5;
const SAME_DAY_TOLERANCE_DAYS = 3;

export type RowStatus =
  | 'new'
  | 'duplicate' // already in the ledger (same statement row, or the same trade from AHL JSON / a manual entry)
  | 'previously-removed' // this statement row was imported before and then voided or corrected
  | 'ambiguous'; // could be an existing trade: the user must decide

export type RowResolution = {
  /** import = add as a new trade, skip = do not add (it is an existing trade or unwanted). */
  action?: 'import' | 'skip';
  /** User-confirmed or corrected execution date. */
  date?: string;
};

export type PlanRow = {
  trade: StatementTrade;
  status: RowStatus;
  /** Ids of existing ledger trades this row is the same as (consumed once). */
  matchedIds: string[];
  /** For ambiguous rows: lookalike trades and why they might be the same. */
  candidates: { id: string; source: string; reason: string }[];
  action: 'import' | 'skip';
  /** Date that will be stored, after any user correction. */
  date: string;
  dateCertainty: 'confirmed' | 'inferred';
  needsResolution: boolean;
  resolutionReason?: string;
};

export type InferredPlan = {
  /** Identity of the sale this acquisition is for. */
  forSale: string;
  ticker: string;
  shares: number;
  pricing: IpoPricing;
  /** Price and date after any user edit. */
  price: number;
  date: string;
  edited: boolean;
  saleDate: string;
  /** What happens to an acquisition assumed by an earlier import. */
  existingId?: string;
  change: 'new' | 'keep' | 'replace';
  ipo?: IpoLookup;
  /** Extracted (not curated) offer evidence waiting for the user's acceptance. */
  needsAcceptance: boolean;
};

export type PlanOptions = {
  resolutions?: Record<string, RowResolution>;
  ipo?: Record<string, IpoLookup | undefined>;
  /** Tickers whose extracted (non-curated) IPO price the user accepted. */
  acceptedIpo?: Record<string, boolean>;
  /** User edits to an assumed acquisition, keyed by the identity of its sale. */
  inferredEdits?: Record<string, { price?: number; date?: string }>;
  /** Opening-balance ids the user chose to keep even though the statement reproduces them. */
  keepOpenings?: Record<string, boolean>;
  /** Splits the user accepted in the review; planned and applied as if already in the ledger. */
  splits?: StockSplit[];
  newId?: () => string;
};

export type HoldingChange = {
  ticker: string;
  beforeShares: number;
  afterShares: number;
  beforeCostKnown: boolean;
  afterCostKnown: boolean;
};

export type AhlImportPlan = {
  accountFingerprint: string;
  range: { from: string; to: string };
  rows: PlanRow[];
  inferred: InferredPlan[];
  /** Existing opening balances the statement history replaces. */
  replacedOpenings: { id: string; ticker: string; shares: number; date: string }[];
  /** Existing assumed acquisitions voided because later real purchases cover them. */
  voidedInferred: { id: string; ticker: string; shares: number; reason: string }[];
  newCompanies: string[];
  /** Splits that will be added with the import. */
  splits: StockSplit[];
  excluded: AhlLedgerStatement['excluded'];
  holdingChanges: HoldingChange[];
  warnings: string[];
  /** Why the plan cannot be committed yet. Empty = ready. */
  blockers: string[];
  counts: { new: number; duplicate: number; ambiguous: number; removed: number; imported: number };
};

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / dayMs;
const netOf = (t: Trade) => (t.kind === 'sell' ? t.shares * t.price! - t.fees : t.shares * t.price! + t.fees);
const sourceOf = (t: Trade) => t.source ?? 'manual';
const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

type Consumed = Set<string>;

/** One existing trade, or a group of same-day fills that together equal the statement row. */
function findStrongMatch(row: StatementTrade, date: string, certain: boolean, pool: Trade[], consumed: Consumed): Trade[] | null {
  const dateOk = (t: Trade) => (certain ? t.date === date : daysBetween(t.date, date) <= SAME_DAY_TOLERANCE_DAYS);
  const same = pool.filter(
    (t) => !consumed.has(t.id) && t.ticker === row.ticker && t.kind === row.kind && dateOk(t),
  );
  const single = same.find((t) => t.shares === row.shares && Math.abs(netOf(t) - row.netCash) <= NET_TOLERANCE);
  if (single) return [single];
  // Aggregate: several execution fills on one date make up the statement's single row.
  const byDate = new Map<string, Trade[]>();
  for (const t of same) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  for (const group of byDate.values()) {
    if (group.length < 2 || group.length > 12) continue;
    const found = subsetEqual(group, row);
    if (found) return found;
  }
  return null;
}

function subsetEqual(group: Trade[], row: StatementTrade): Trade[] | null {
  let best: Trade[] | null = null;
  const walk = (index: number, chosen: Trade[], shares: number, net: number) => {
    if (best) return;
    if (shares === row.shares && chosen.length >= 2) {
      if (Math.abs(net - row.netCash) <= NET_TOLERANCE * chosen.length) best = chosen;
      return;
    }
    if (shares >= row.shares || index >= group.length) return;
    walk(index + 1, [...chosen, group[index]], shares + group[index].shares, net + netOf(group[index]));
    walk(index + 1, chosen, shares, net);
  };
  walk(0, [], 0, 0);
  return best;
}

function findLookalikes(row: StatementTrade, date: string, pool: Trade[], consumed: Consumed) {
  return pool
    .filter(
      (t) =>
        !consumed.has(t.id) &&
        t.ticker === row.ticker &&
        t.kind === row.kind &&
        t.shares === row.shares &&
        daysBetween(t.date, date) <= NEAR_DAYS,
    )
    .map((t) => ({
      id: t.id,
      source: sourceOf(t),
      reason:
        sourceOf(t) === 'finqalab'
          ? `Another broker's trade on ${t.date} with the same quantity; never merged automatically.`
          : `Same symbol, side and quantity on ${t.date}; cash ${netOf(t).toFixed(2)} vs statement ${row.netCash.toFixed(2)}.`,
    }));
}

export function planAhlLedgerImport(
  original: Portfolio,
  statement: Pick<AhlLedgerStatement, 'trades' | 'accountFingerprint' | 'from' | 'to' | 'excluded' | 'warnings'>,
  options: PlanOptions = {},
): AhlImportPlan {
  const portfolio = withSplits(original, options.splits);
  const resolutions = options.resolutions ?? {};
  const newId = options.newId ?? (() => crypto.randomUUID());
  const active = portfolio.trades.filter((t) => !t.voided);
  const byExternal = new Map(active.filter((t) => t.externalId).map((t) => [t.externalId!, t]));
  const removed = new Set(portfolio.trades.filter((t) => t.voided && t.externalId).map((t) => t.externalId!));
  // Real trades a statement row may be the same as: not assumed acquisitions, not rows of this statement format.
  const pool = active.filter(
    (t) => (t.kind === 'buy' || t.kind === 'sell') && !t.inferred && !t.externalId?.startsWith('ahlpdf:'),
  );
  const consumed: Consumed = new Set();
  const rows: PlanRow[] = [];

  for (const trade of statement.trades) {
    const resolution = resolutions[trade.identity] ?? {};
    const userDate = resolution.date && dateOK(resolution.date) ? resolution.date : undefined;
    const date = userDate ?? trade.executionDate;
    const certain = userDate !== undefined || trade.dateCertainty === 'confirmed';
    const base = { trade, matchedIds: [] as string[], candidates: [] as PlanRow['candidates'], date, dateCertainty: certain ? 'confirmed' as const : 'inferred' as const };
    const existing = byExternal.get(trade.identity);
    if (existing) {
      consumed.add(existing.id);
      rows.push({ ...base, status: 'duplicate', matchedIds: [existing.id], action: 'skip', needsResolution: false });
      continue;
    }
    if (removed.has(trade.identity)) {
      const action = resolution.action ?? 'skip';
      rows.push({
        ...base, status: 'previously-removed', action, needsResolution: false,
        resolutionReason: 'Imported earlier, then voided or corrected. Skipped unless you choose to import it again.',
      });
      continue;
    }
    const strong = findStrongMatch(trade, date, certain, pool, consumed);
    if (strong) {
      const other = strong.find((t) => sourceOf(t) === 'finqalab');
      if (!other) {
        strong.forEach((t) => consumed.add(t.id));
        rows.push({ ...base, status: 'duplicate', matchedIds: strong.map((t) => t.id), action: 'skip', needsResolution: false });
        continue;
      }
    }
    const candidates = strong
      ? strong.map((t) => ({ id: t.id, source: sourceOf(t), reason: `Matches another broker's trade on ${t.date}; never merged automatically.` }))
      : findLookalikes(trade, date, pool, consumed);
    if (candidates.length) {
      const action = resolution.action;
      if (action === 'skip') candidates.forEach((c) => consumed.add(c.id));
      rows.push({
        ...base, status: 'ambiguous', candidates, action: action ?? 'skip',
        matchedIds: action === 'skip' ? candidates.map((c) => c.id) : [],
        needsResolution: action === undefined,
        resolutionReason: 'Looks like a trade already in your ledger. Choose whether it is the same trade.',
      });
      continue;
    }
    const action = resolution.action ?? 'import';
    const unconfirmedDate = !certain && action === 'import';
    rows.push({
      ...base, status: 'new', action, needsResolution: unconfirmedDate,
      resolutionReason: unconfirmedDate
        ? `The execution date depends on holidays that are not officially confirmed (settled ${trade.settlementDate}, ${trade.settlement}). Confirm or correct it.`
        : undefined,
    });
  }

  const blockers: string[] = [];
  const warnings = [...statement.warnings];
  const importing = rows.filter((r) => r.action === 'import');

  // Assemble the trades to add, then size assumed acquisitions on the resulting ledger.
  const makeTrade = (row: PlanRow): Trade => ({
    id: `ahl-${row.trade.kind === 'buy' ? 'b' : 's'}-${newId()}`,
    ticker: row.trade.ticker, kind: row.trade.kind, date: row.date, shares: row.trade.shares,
    price: row.trade.price, fees: row.trade.fees,
    month: row.trade.kind === 'buy' ? row.date.slice(0, 7) : '',
    note: `Imported from AHL Client Ledger PDF (voucher ${row.trade.voucher}, settled ${row.trade.settlementDate}).`,
    source: 'ahl', externalId: row.trade.identity,
    settlementDate: row.trade.settlementDate, dateCertainty: row.dateCertainty,
    statementRef: row.trade.statementRef, netCash: row.trade.netCash,
  });
  const additions = importing.map((row) => ({ row, trade: makeTrade(row) }));
  const tickers = [...new Set(statement.trades.map((t) => t.ticker))];

  // Opening balances the statement history reproduces exactly are replaced (as the JSON import does).
  const replacedOpenings: AhlImportPlan['replacedOpenings'] = [];
  for (const opening of active.filter((t) => t.kind === 'opening' && sourceOf(t) !== 'finqalab')) {
    if (!tickers.includes(opening.ticker) || options.keepOpenings?.[opening.id]) continue;
    const rowsFor = rows.filter((r) => r.trade.ticker === opening.ticker && (r.action === 'import' || r.status === 'duplicate'));
    const shares = sharesThrough(portfolio, opening.ticker, opening.date, rowsFor);
    if (shares === opening.shares) replacedOpenings.push({ id: opening.id, ticker: opening.ticker, shares: opening.shares, date: opening.date });
  }

  // Working ledger: existing real trades (openings the statement replaces removed), plus the additions.
  const replacedIds = new Set(replacedOpenings.map((o) => o.id));
  const existingInferred = active.filter((t) => t.inferred);
  const work: Portfolio = {
    ...portfolio,
    companies: [...portfolio.companies],
    trades: [
      ...active.filter((t) => !t.inferred && !replacedIds.has(t.id)),
      ...additions.map((a) => a.trade),
    ],
  };
  const newCompanies = tickers.filter((t) => !work.companies.some((c) => c.ticker === t) && additions.some((a) => a.row.trade.ticker === t));
  for (const ticker of newCompanies) work.companies.push(placeholderCompany(ticker));

  // Which ledger sale belongs to which statement row.
  const saleOwner = new Map<string, PlanRow>();
  for (const a of additions) if (a.trade.kind === 'sell') saleOwner.set(a.trade.id, a.row);
  for (const row of rows) if (row.trade.kind === 'sell' && row.status !== 'ambiguous') for (const id of row.matchedIds) saleOwner.set(id, row);
  for (const row of rows) if (row.trade.kind === 'sell' && row.status === 'ambiguous' && row.action === 'skip') for (const id of row.matchedIds) saleOwner.set(id, row);

  const inferred: InferredPlan[] = [];
  const desired = new Set<string>();
  for (const ticker of tickers) {
    for (const gap of saleShortfalls(work, ticker)) {
      const row = saleOwner.get(gap.tradeId);
      if (!row) continue; // a shortfall in history this statement did not bring in is not ours to paper over
      const lookup = options.ipo?.[ticker];
      const accepted = lookup?.status === 'found' && (lookup.verification === 'curated' || options.acceptedIpo?.[ticker] === true);
      const pricing = priceAssumedAcquisition({
        ticker, saleDate: row.date, salePrice: row.trade.price, lookup, acceptExtracted: accepted,
      });
      const edit = options.inferredEdits?.[row.trade.identity];
      const price = edit?.price !== undefined && edit.price > 0 ? edit.price : pricing.price;
      const date = edit?.date && dateOK(edit.date) && edit.date <= row.date ? edit.date : pricing.date;
      const edited = price !== pricing.price || date !== pricing.date;
      const prior = existingInferred.find((t) => t.inferred!.forSale === row.trade.identity);
      const change: InferredPlan['change'] = !prior ? 'new' : prior.shares === gap.shortfall ? 'keep' : 'replace';
      desired.add(row.trade.identity);
      inferred.push({
        forSale: row.trade.identity, ticker, shares: gap.shortfall, pricing, price, date, edited,
        saleDate: row.date, existingId: prior?.id, change, ipo: lookup,
        needsAcceptance: lookup?.status === 'found' && lookup.verification === 'extracted' && !accepted,
      });
    }
  }
  // Assumed acquisitions an earlier import made that real purchases now cover (fully or partly).
  const voidedInferred: AhlImportPlan['voidedInferred'] = [];
  for (const prior of existingInferred) {
    if (!tickers.includes(prior.ticker)) continue;
    const next = inferred.find((i) => i.forSale === prior.inferred!.forSale);
    if (!next) voidedInferred.push({ id: prior.id, ticker: prior.ticker, shares: prior.shares, reason: 'Now covered by imported purchases.' });
    else if (next.change === 'replace') voidedInferred.push({ id: prior.id, ticker: prior.ticker, shares: prior.shares, reason: `Reduced to the ${next.shares} shares still uncovered.` });
  }

  // What the ledger looks like after the plan: validate and summarise holdings.
  let holdingChanges: HoldingChange[] = [];
  const after = materialize(portfolio, { additions: additions.map((a) => a.trade), inferred, replacedIds, voided: new Set(voidedInferred.map((v) => v.id)), newCompanies, newId });
  try {
    validate(after);
    const before = holdings(original);
    const now = holdings(after);
    holdingChanges = tickers
      .map((ticker) => {
        const b = before.find((h) => h.ticker === ticker);
        const a = now.find((h) => h.ticker === ticker);
        return {
          ticker,
          beforeShares: b?.shares ?? 0, afterShares: a?.shares ?? 0,
          beforeCostKnown: b ? b.cost !== null : true, afterCostKnown: a ? a.cost !== null : true,
        };
      })
      .filter((c) => c.beforeShares !== c.afterShares || c.beforeCostKnown !== c.afterCostKnown);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const unresolved = rows.filter((r) => r.needsResolution);
  if (unresolved.length) blockers.push(`${unresolved.length} row${unresolved.length === 1 ? '' : 's'} need your decision before importing.`);
  const counts = {
    new: rows.filter((r) => r.status === 'new').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    ambiguous: rows.filter((r) => r.status === 'ambiguous').length,
    removed: rows.filter((r) => r.status === 'previously-removed').length,
    imported: importing.length,
  };
  if (inferred.some((i) => i.pricing.basis === 'sale-price-fallback'))
    warnings.push('Some sales have no purchase history. Their cost basis is a user-requested estimate, not broker data (see the assumed acquisitions).');
  return {
    accountFingerprint: statement.accountFingerprint, range: { from: statement.from, to: statement.to },
    rows, inferred, replacedOpenings, voidedInferred, newCompanies, splits: options.splits ?? [], excluded: statement.excluded,
    holdingChanges, warnings, blockers, counts,
  };
}

function placeholderCompany(ticker: string): Company {
  return {
    ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '',
    note: 'Added from an AHL Client Ledger import. Review company details before any new SIP allocation.',
  };
}

function sharesThrough(portfolio: Portfolio, ticker: string, throughDate: string, rows: PlanRow[]) {
  type Event = { date: string; delta: number; split?: [number, number] };
  const events: Event[] = [
    ...rows
      .filter((r) => r.date <= throughDate)
      .map((r): Event => ({ date: r.date, delta: r.trade.kind === 'buy' ? r.trade.shares : -r.trade.shares })),
    ...(portfolio.stockSplits ?? [])
      .filter((s) => !s.voided && s.ticker === ticker && s.date <= throughDate)
      .map((s): Event => ({ date: s.date, delta: 0, split: [s.newShares, s.oldShares] })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.split ? -1 : 1));
  let shares = 0;
  for (const e of events) shares = e.split ? (shares * e.split[0]) / e.split[1] : shares + e.delta;
  return shares;
}

function materialize(
  portfolio: Portfolio,
  parts: {
    additions: Trade[];
    inferred: InferredPlan[];
    replacedIds: Set<string>;
    voided: Set<string>;
    newCompanies: string[];
    newId: () => string;
  },
): Portfolio {
  const copy = JSON.parse(JSON.stringify(portfolio)) as Portfolio;
  const targets = new Set([...parts.replacedIds, ...parts.voided, ...parts.inferred.filter((i) => i.change === 'replace' && i.existingId).map((i) => i.existingId!)]);
  const stamp = new Map<string, string>();
  for (const trade of copy.trades) if (targets.has(trade.id)) trade.voided = true;
  for (const i of parts.inferred) {
    if (i.change === 'keep') continue;
    const id = `ahl-b-inf-${hash(i.forSale)}-${hash(String(i.shares) + i.date + i.price)}`;
    stamp.set(i.forSale, id);
    copy.trades.push({
      id, ticker: i.ticker, kind: 'buy', date: i.date, shares: i.shares, price: i.price, fees: 0, month: '',
      note: i.pricing.label + (i.edited ? ' Edited by you before import.' : ''),
      source: 'ahl', externalId: `ahl:inferred:${i.ticker}:${hash(i.forSale)}:${i.shares}:${hash(String(i.price) + i.date)}`,
      dateCertainty: 'inferred',
      inferred: {
        basis: i.pricing.basis, priceSource: i.pricing.priceSource.slice(0, 300), dateBasis: i.pricing.dateBasis,
        forSale: i.forSale, label: (i.pricing.label + (i.edited ? ' Edited by you.' : '')).slice(0, 300),
      },
    });
  }
  // Audit: the voided assumed acquisitions point at what replaced them.
  const replacement = new Map(parts.inferred.filter((i) => i.change === 'replace' && i.existingId).map((i) => [i.existingId!, stamp.get(i.forSale)!]));
  const firstReal = new Map<string, string>();
  for (const t of parts.additions) if (t.kind === 'buy' && !firstReal.has(t.ticker)) firstReal.set(t.ticker, t.id);
  for (const trade of copy.trades)
    if (trade.inferred && trade.voided && targets.has(trade.id) && !trade.supersededBy)
      trade.supersededBy = replacement.get(trade.id) ?? firstReal.get(trade.ticker) ?? 'imported-purchases';
  for (const ticker of parts.newCompanies) copy.companies.push(placeholderCompany(ticker));
  copy.trades.push(...parts.additions);
  return copy;
}

/**
 * The portfolio after the plan. Throws unless the plan is ready (no blockers). The caller saves it through
 * the revisioned PUT; a plan made from an older revision must be re-planned first.
 */
export function applyAhlLedgerPlan(portfolio: Portfolio, plan: AhlImportPlan, newId: () => string = () => crypto.randomUUID()): Portfolio {
  if (plan.blockers.length) throw new Error(plan.blockers[0]);
  const additions: Trade[] = plan.rows
    .filter((r) => r.action === 'import')
    .map((row) => ({
      id: `ahl-${row.trade.kind === 'buy' ? 'b' : 's'}-${newId()}`,
      ticker: row.trade.ticker, kind: row.trade.kind, date: row.date, shares: row.trade.shares,
      price: row.trade.price, fees: row.trade.fees,
      month: row.trade.kind === 'buy' ? row.date.slice(0, 7) : '',
      note: `Imported from AHL Client Ledger PDF (voucher ${row.trade.voucher}, settled ${row.trade.settlementDate}).`,
      source: 'ahl' as const, externalId: row.trade.identity,
      settlementDate: row.trade.settlementDate, dateCertainty: row.dateCertainty,
      statementRef: row.trade.statementRef, netCash: row.trade.netCash,
    }));
  const next = materialize(withSplits(portfolio, plan.splits), {
    additions, inferred: plan.inferred,
    replacedIds: new Set(plan.replacedOpenings.map((o) => o.id)),
    voided: new Set(plan.voidedInferred.map((v) => v.id)),
    newCompanies: plan.newCompanies, newId,
  });
  validate(next);
  return next;
}

/** True when a plan changes nothing (an exact re-upload or fully overlapping report). */
export const planIsNoop = (plan: AhlImportPlan) =>
  plan.rows.every((r) => r.action === 'skip') &&
  plan.inferred.every((i) => i.change === 'keep') &&
  !plan.replacedOpenings.length &&
  !plan.voidedInferred.length &&
  !plan.splits.length &&
  !plan.newCompanies.length;
