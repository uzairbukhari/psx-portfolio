import { holdings, validate, type Company, type Portfolio, type StockSplit, type Trade } from '../lib/portfolio.ts';
import type { HoldingChange } from '../lib/ahl-reconcile.ts';
import { withSplits } from '../lib/import-splits.ts';

export type FinqalabTrade = {
  ticker: string;
  tradeNo: string;
  date: string;
  kind: 'buy' | 'sell';
  price: number;
  shares: number;
  fees: number;
};

export type FinqalabImportSummary = {
  companies: Company[];
  trades: Trade[];
  imported: number;
  skippedDuplicate: number;
  skippedManualMatch: number;
  addedCompanies: number;
};

const rowPattern = /\b([A-Z0-9]{2,12})\s+(\d+)\s+(?:\d+\s+)?(\d{4}-\d{2}-\d{2})\s+\d{4}-\d{2}-\d{2}\s+(BUY|SELL)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g;

function number(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw Error(`Invalid ${label} in Finqalab report.`);
  return parsed;
}

/** Parses only Finqalab's current Periodic Trade Details Report line items. */
export function parseFinqalabReport(text: string): FinqalabTrade[] {
  if (!/Periodic\s+Trade\s+Details\s+Report\s+By\s+Finqalab/i.test(text))
    throw Error('Choose a Finqalab Periodic Trade Details Report PDF.');
  const total = /Total\s+Records:\s*(\d+)/i.exec(text);
  if (!total) throw Error('Finqalab report is missing its Total Records count.');
  const rows: FinqalabTrade[] = [];
  const tradeNos = new Set<string>();
  for (const match of text.matchAll(rowPattern)) {
    const [, ticker, tradeNo, date, side, rawPrice, rawShares, , , rawFees] = match;
    if (tradeNos.has(tradeNo)) throw Error('Finqalab report contains a repeated Trade No.');
    const price = number(rawPrice, 'rate');
    const shares = number(rawShares, 'quantity');
    const fees = number(rawFees, 'broker charge');
    if (!Number.isSafeInteger(shares) || shares <= 0 || price <= 0)
      throw Error('Finqalab report contains an invalid trade line.');
    tradeNos.add(tradeNo);
    rows.push({
      ticker,
      tradeNo,
      date,
      kind: side === 'BUY' ? 'buy' : 'sell',
      price,
      shares,
      fees,
    });
  }
  if (rows.length !== Number(total[1]))
    throw Error(`Finqalab report says it has ${total[1]} trades, but ${rows.length} readable trade lines were found.`);
  return rows;
}

function sameManualTrade(existing: Trade, incoming: FinqalabTrade) {
  return (
    !existing.voided &&
    existing.source !== 'finqalab' &&
    existing.ticker === incoming.ticker &&
    existing.kind === incoming.kind &&
    existing.date === incoming.date &&
    existing.shares === incoming.shares &&
    existing.price === incoming.price &&
    existing.fees === incoming.fees
  );
}

export function importFinqalabTrades(
  portfolio: Portfolio,
  incoming: FinqalabTrade[],
): FinqalabImportSummary {
  const companies = [...portfolio.companies];
  const trades: Trade[] = [];
  const tickers = new Set(companies.map((company) => company.ticker));
  const importedIds = new Set(
    portfolio.trades
      .filter((trade) => !trade.voided && trade.source === 'finqalab')
      .map((trade) => trade.externalId),
  );
  let skippedDuplicate = 0;
  let skippedManualMatch = 0;
  let addedCompanies = 0;
  for (const entry of incoming) {
    const externalId = `finqalab:${entry.tradeNo}`;
    if (importedIds.has(externalId)) {
      skippedDuplicate++;
      continue;
    }
    if (portfolio.trades.some((trade) => sameManualTrade(trade, entry))) {
      skippedManualMatch++;
      continue;
    }
    if (!tickers.has(entry.ticker)) {
      companies.push({
        ticker: entry.ticker,
        name: entry.ticker,
        sector: '',
        target: 0,
        approved: false,
        screenDate: '',
        note: 'Added from a Finqalab trade import. Review company details before any new SIP allocation.',
      });
      tickers.add(entry.ticker);
      addedCompanies++;
    }
    trades.push({
      id: crypto.randomUUID(),
      ticker: entry.ticker,
      kind: entry.kind,
      date: entry.date,
      shares: entry.shares,
      price: entry.price,
      fees: entry.fees,
      month: entry.kind === 'buy' ? entry.date.slice(0, 7) : '',
      note: `Imported from Finqalab Trade No. ${entry.tradeNo}.`,
      source: 'finqalab',
      externalId,
    });
    importedIds.add(externalId);
  }
  return {
    companies,
    trades,
    imported: trades.length,
    skippedDuplicate,
    skippedManualMatch,
    addedCompanies,
  };
}

// --- reviewable plan (same shape of decisions as the AHL import) -------------------------------------------

export type FinqalabRowStatus =
  | 'new'
  | 'duplicate' // already imported from Finqalab, or an identical entry of your own
  | 'previously-removed' // imported before and then voided
  | 'ambiguous'; // looks like an existing trade with different price or fees: the user decides

export type FinqalabResolution = { action?: 'import' | 'skip' };
export type FinqalabPlanRow = {
  trade: FinqalabTrade;
  externalId: string;
  status: FinqalabRowStatus;
  action: 'import' | 'skip';
  candidates: { id: string; source: string; reason: string }[];
  matchedIds: string[];
  needsResolution: boolean;
};
export type FinqalabPlan = {
  range: { from: string; to: string };
  rows: FinqalabPlanRow[];
  newCompanies: string[];
  splits: StockSplit[];
  holdingChanges: HoldingChange[];
  warnings: string[];
  blockers: string[];
  counts: { new: number; duplicate: number; ambiguous: number; removed: number; imported: number };
};
export type FinqalabPlanOptions = { resolutions?: Record<string, FinqalabResolution>; splits?: StockSplit[] };

const sourceOf = (t: Trade) => t.source ?? 'manual';
const placeholderCompany = (ticker: string): Company => ({
  ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '',
  note: 'Added from a Finqalab trade import. Review company details before any new SIP allocation.',
});

/** Pure: what importing these rows would do, re-run after every decision. */
export function planFinqalabImport(
  original: Portfolio,
  incoming: FinqalabTrade[],
  options: FinqalabPlanOptions = {},
): FinqalabPlan {
  const portfolio = withSplits(original, options.splits);
  const resolutions = options.resolutions ?? {};
  const active = portfolio.trades.filter((t) => !t.voided);
  const byExternal = new Map(active.filter((t) => t.source === 'finqalab' && t.externalId).map((t) => [t.externalId!, t]));
  const removed = new Set(portfolio.trades.filter((t) => t.voided && t.source === 'finqalab' && t.externalId).map((t) => t.externalId!));
  const pool = active.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.source !== 'finqalab' && !t.inferred);
  const consumed = new Set<string>();
  const rows: FinqalabPlanRow[] = [];

  for (const trade of incoming) {
    const externalId = `finqalab:${trade.tradeNo}`;
    const base = { trade, externalId, candidates: [] as FinqalabPlanRow['candidates'], matchedIds: [] as string[] };
    const existing = byExternal.get(externalId);
    if (existing) {
      rows.push({ ...base, status: 'duplicate', action: 'skip', needsResolution: false, matchedIds: [existing.id] });
      continue;
    }
    if (removed.has(externalId)) {
      rows.push({ ...base, status: 'previously-removed', action: resolutions[externalId]?.action ?? 'skip', needsResolution: false });
      continue;
    }
    const same = pool.filter((t) => !consumed.has(t.id) && t.ticker === trade.ticker && t.kind === trade.kind && t.date === trade.date && t.shares === trade.shares);
    const exact = same.find((t) => t.price === trade.price && t.fees === trade.fees);
    if (exact) {
      consumed.add(exact.id);
      rows.push({ ...base, status: 'duplicate', action: 'skip', needsResolution: false, matchedIds: [exact.id] });
      continue;
    }
    if (same.length) {
      const choice = resolutions[externalId]?.action;
      rows.push({
        ...base, status: 'ambiguous', action: choice ?? 'skip', needsResolution: !choice,
        candidates: same.map((t) => ({
          id: t.id, source: sourceOf(t),
          reason: `Your ${sourceOf(t)} entry on ${t.date}: same quantity, price ${t.price} and fees ${t.fees} (Finqalab: ${trade.price}, ${trade.fees}).`,
        })),
      });
      if (choice === 'skip') for (const t of same) consumed.add(t.id);
      continue;
    }
    rows.push({ ...base, status: 'new', action: resolutions[externalId]?.action ?? 'import', needsResolution: false });
  }

  const importing = rows.filter((r) => r.action === 'import');
  const known = new Set(portfolio.companies.map((c) => c.ticker));
  const newCompanies = [...new Set(importing.map((r) => r.trade.ticker))].filter((t) => !known.has(t)).sort();
  const tickers = [...new Set(incoming.map((r) => r.ticker))];
  const dates = incoming.map((r) => r.date).sort();
  const blockers: string[] = [];
  const warnings: string[] = [];
  let holdingChanges: HoldingChange[] = [];

  let previewId = 0;
  const after = materializeFinqalab(portfolio, importing, newCompanies, () => `fq-preview-${++previewId}`);
  try {
    validate(after);
    const before = holdings(original);
    const now = holdings(after);
    holdingChanges = tickers
      .map((ticker) => {
        const b = before.find((h) => h.ticker === ticker);
        const a = now.find((h) => h.ticker === ticker);
        return {
          ticker, beforeShares: b?.shares ?? 0, afterShares: a?.shares ?? 0,
          beforeCostKnown: b ? b.cost !== null : true, afterCostKnown: a ? a.cost !== null : true,
        };
      })
      .filter((c) => c.beforeShares !== c.afterShares || c.beforeCostKnown !== c.afterCostKnown);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const unresolved = rows.filter((r) => r.needsResolution).length;
  if (unresolved) blockers.push(`${unresolved} row${unresolved === 1 ? '' : 's'} need your decision before importing.`);
  return {
    range: { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
    rows, newCompanies, splits: options.splits ?? [], holdingChanges, warnings, blockers,
    counts: {
      new: rows.filter((r) => r.status === 'new').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
      ambiguous: rows.filter((r) => r.status === 'ambiguous').length,
      removed: rows.filter((r) => r.status === 'previously-removed').length,
      imported: importing.length,
    },
  };
}

function materializeFinqalab(portfolio: Portfolio, rows: FinqalabPlanRow[], newCompanies: string[], newId: () => string): Portfolio {
  const copy = JSON.parse(JSON.stringify(portfolio)) as Portfolio;
  for (const ticker of newCompanies) copy.companies.push(placeholderCompany(ticker));
  for (const { trade, externalId } of rows)
    copy.trades.push({
      id: newId(), ticker: trade.ticker, kind: trade.kind, date: trade.date, shares: trade.shares, price: trade.price, fees: trade.fees,
      month: trade.kind === 'buy' ? trade.date.slice(0, 7) : '',
      note: `Imported from Finqalab Trade No. ${trade.tradeNo}.`,
      source: 'finqalab', externalId,
    });
  return copy;
}

/** The portfolio after the plan. Throws while the plan has blockers. */
export function applyFinqalabPlan(portfolio: Portfolio, plan: FinqalabPlan, newId: () => string = () => crypto.randomUUID()): Portfolio {
  if (plan.blockers.length) throw new Error(plan.blockers[0]);
  // A previously removed row the user chose to import again replaces nothing: the voided trade stays as history,
  // so give the new trade the same key only when no active trade holds it (validate enforces uniqueness).
  const next = materializeFinqalab(withSplits(portfolio, plan.splits), plan.rows.filter((r) => r.action === 'import'), plan.newCompanies, newId);
  validate(next);
  return next;
}

export const finqalabPlanIsNoop = (plan: FinqalabPlan) => plan.rows.every((r) => r.action === 'skip') && !plan.splits.length && !plan.newCompanies.length;
