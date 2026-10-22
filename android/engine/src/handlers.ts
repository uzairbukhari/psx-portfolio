// The calls the Android app makes into the shared TypeScript. Pure and free of platform globals, so the same
// code runs in Node tests (tests/android-engine.test.mjs) and inside the Jetpack JavaScript sandbox.
// Every call takes and returns JSON text; the account stays inside the isolate between calls so the phone never
// re-sends the whole portfolio for each screen.
import {
  ALL_PORTFOLIOS,
  accountFromPortfolio,
  assertAccountWritable,
  dashboardPortfolio,
  normalizeAccount,
  accountTaxProfile,
  hasFinancialRecords,
  LEGACY_PORTFOLIO_ID,
  portfolioName,
  removePortfolio,
  renamePortfolio,
  setAccountFilerStatus,
  setPortfolioLocked,
  type PortfolioAccount,
} from '../../../lib/portfolio-account.ts';
import { openPositions, priceTickers, safeHoldings, soldOutPositions, totals, type Holding } from '../../../mobile/src/data/derive.ts';
import { filterBySector, holdingFlags, sectorsOf, sortHoldings, weightOf, type HoldingSort } from '../../../mobile/src/data/holdings-view.ts';
import { SECTORS, blankPortfolio, money, today } from '../../../lib/portfolio.ts';
import { contentsLabel, portfolioContents } from '../../../mobile/src/data/scope.ts';
import { activityEntries, companyDividends, readOnlyReason } from '../../../mobile/src/data/derive.ts';
import { parseEod, parseIntraday, rangeChange, sliceRange, type HistoryRange } from '../../../lib/price-history.ts';
import { filterActivity, groupByMonth, type ActivityFilter } from '../../../mobile/src/data/activity-view.ts';
import { mutateAccount, mutateBlueprint } from './mutate.ts';
import { tradeTotals, filterCompanies } from '../../../mobile/src/data/entry-form.ts';
import { buildPlan, currentMonth, monthBuys, unifiedPlanSource } from '../../../mobile/src/data/sip.ts';
import { parseReview, type ReviewRow } from '../../../mobile/src/data/record-buys.ts';
import { parseNumber } from '../../../mobile/src/data/mutations.ts';
import { accountBackupShare } from '../../../mobile/src/data/backup.ts';
import { planAutoDividendUpdate } from '../../../lib/dividend-sync.ts';
import { applyLookups, hasPlaceholderDetails } from '../../../lib/company-enrichment.ts';
import { mergeQuotes, type QuoteRow } from '../../../lib/quote-merge.ts';
import { evenWeights, screenStatus, targetRows, targetTotals } from '../../../lib/targets.ts';
import { MAX_SHORTLIST, initialShortlist, pickSources, searchCompanies } from '../../../mobile/src/data/picks.ts';
import { estimateMonthlyPicks } from '../../../lib/monthly-picks.ts';
import { explainSizing } from '../../../lib/monthly-picks-allocation.ts';
import { portfolioCounts } from '../../../lib/portfolio-counts.ts';
import {
  clearAll,
  clearOne,
  deleteCleared,
  expectedDividendFor,
  filterNotifications,
  isUnread,
  markAllRead,
  notificationCounts,
  restoreOne,
  setRead,
  type NotificationFilter,
} from '../../../lib/notification-actions.ts';
import type { AppNotification } from '../../../lib/portfolio.ts';
import { pakistanMarketState } from '../../../lib/psx-market.ts';
import { portfolioReport } from '../../../lib/portfolio-reports.ts';
import { tradedTickers } from '../../../lib/performance.ts';
import { benchmarkView, buildTrackRecord, historyBatches, returnView, valueChartView, type TrackRange } from '../../../mobile/src/data/track-record.ts';
import { classifyFacts, GATHER_TIMEOUT_MS, needsScrape } from '../../../lib/monthly-picks-flow.ts';
import { parsePublicAnalysis, pollIntervalMs } from '../../../lib/api-validate.ts';
import { WEIGHT_CAP } from '../../../lib/portfolio.ts';
import { monthProgress, nextActions, returnBreakdown } from '../../../mobile/src/data/today.ts';
import { accountOverview } from '../../../lib/account-overview.ts';
import { dividendPayments, realisedProfit, tradeMarkers, weightInStocks } from '../../../lib/company-view.ts';
import { formatStat, keyStats, type CompanyStats } from '../../../lib/company-stats.ts';
import { faceValueFor } from '../../../lib/face-values.ts';
import { accountSipBlueprint } from '../../../lib/portfolio-account.ts';
import {
  DEFAULT_RETURNS,
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  SIP_BUDGET_PILLS,
  SIP_PRESETS,
  SIP_PRESET_ORDER,
  STREAK_THRESHOLD,
  blankBlueprint,
  blendedReturn,
  lakh,
  milestones,
  mixAfter,
  planMonth,
  presetTargets,
  projectScenario,
  projectSip,
  rebalanceEdit,
  skipCost,
  targetsTotal,
  type SipClass,
  type SipLevers,
} from '../../../lib/sip-blueprint.ts';
import { LONG_RUN_INFLATION, classWeights, rowHint, sipView } from '../../../lib/sip-blueprint-data.ts';
import {
  MAX_LOOK_AHEAD,
  compareScenarios,
  goalTakeaway,
  goalWays,
  scenarioPresets,
  type ScenarioLine,
} from '../../../lib/sip-scenarios.ts';
import { describePieces, valueAsset, valueMetal, type Asset, type MetalAsset } from '../../../lib/assets.ts';
import { valueCurrency, type CurrencyAsset } from '../../../lib/currency.ts';
import type { FxRateRow } from '../../../lib/fx-rates.ts';
import { valueFund, type FundAsset } from '../../../lib/funds.ts';
import { dueEntries, planValue, type PlanAsset, type PlanNavRow } from '../../../lib/plans.ts';
import { tolaFromGrams, type MetalRateRow } from '../../../lib/metal-rates.ts';
import type { FundNavRow } from '../../../lib/mufap.ts';

export const ENGINE_API_VERSION = 2;

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

let loaded: PortfolioAccount | null = null;

// Public data (shared quotes, announcements, company details) laid over the stored ledger for display. It is never
// saved: writes start from the stored account, so cached prices do not end up in the encrypted vault.
type Overlay = { quoteRows: QuoteRow[]; announcements: unknown[]; faceValues: Record<string, unknown>; lookups: unknown[] };
let overlay: Overlay = { quoteRows: [], announcements: [], faceValues: {}, lookups: [] };
// Public gold and silver rates and mutual fund prices, kept beside the overlay.
let metalRates: MetalRateRow[] = [];
let fundNavs: FundNavRow[] = [];
let planNavs: PlanNavRow[] = [];
let fxRates: FxRateRow[] = [];
let overlaid: { source: PortfolioAccount; version: number; account: PortfolioAccount } | null = null;
let overlayVersion = 0;

/** The stored account with the public data applied: what every screen reads. */
function viewAccount(): PortfolioAccount {
  const stored = requireAccount();
  if (overlaid && overlaid.source === stored && overlaid.version === overlayVersion) return overlaid.account;
  const account: PortfolioAccount = {
    ...stored,
    portfolios: stored.portfolios.map((entry) => {
      const portfolio = JSON.parse(JSON.stringify(entry.portfolio)) as typeof entry.portfolio;
      portfolio.quotes = mergeQuotes(portfolio.quotes ?? {}, overlay.quoteRows, portfolio.companies.map((c) => c.ticker));
      applyLookups(portfolio.companies, overlay.lookups as Parameters<typeof applyLookups>[1]);
      return { ...entry, portfolio };
    }),
  };
  overlaid = { source: stored, version: overlayVersion, account };
  return account;
}

function requireAccount(): PortfolioAccount {
  if (!loaded) throw new Error('No portfolio is loaded.');
  return loaded;
}

/** The portfolios the chosen scope covers: every one, or the one picked. */
/** The portfolio whose targets and budget drive the monthly plan for this scope (the combined view has none of its own). */
function planPortfolio(account: PortfolioAccount, scope: string) {
  return scope === ALL_PORTFOLIOS && account.portfolios.length > 1 ? unifiedPlanSource(account).portfolio : dashboardPortfolio(account, scope);
}

function scopeParts(args: Args) {
  const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
  const account = viewAccount();
  return scope === ALL_PORTFOLIOS ? account.portfolios : account.portfolios.filter((x) => x.id === scope);
}

/** Projection milestones with the level already in words, so the phone needs no rupee formatter of its own. */
const marked = (points: { year: number; value: number }[], levels: number[]) =>
  milestones(points, levels).map((m) => ({ ...m, label: lakh(m.level) }));

/** The public gold, fund, plan and currency rates the SIP Blueprint values the ledger with. */
const sipRates = () => ({ metalRates, fundNavs, fxRates });

/** An `asOf` the caller passed, or today when it was left out or is not a date. */
const isoOr = (value: unknown, fallback: string): string => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);

const text = (args: Args, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Missing ${key}.`);
  return value;
};

/** One inbox change (read, clear, restore, delete cleared) applied to the stored account, spread back over each portfolio. */
function changeInbox(account: PortfolioAccount, params: Record<string, unknown>): PortfolioAccount {
  const action = String(params.action ?? '');
  const id = typeof params.id === 'string' ? params.id : '';
  const at = new Date().toISOString();
  const change = (list: AppNotification[]): AppNotification[] => {
    switch (action) {
      case 'read': return setRead(list, id, true);
      case 'unread': return setRead(list, id, false);
      case 'clear': return clearOne(list, id, at);
      case 'restore': return restoreOne(list, id);
      case 'markAll': return markAllRead(list);
      case 'clearAll': return clearAll(list, at);
      case 'deleteCleared': return deleteCleared(list);
      default: throw new Error(`Unknown inbox change: ${action}`);
    }
  };
  const scope = typeof params.scope === 'string' ? params.scope : ALL_PORTFOLIOS;
  if (account.portfolios.length > 1 && scope === ALL_PORTFOLIOS) {
    const merged = dashboardPortfolio(account, ALL_PORTFOLIOS).notifications ?? [];
    const next = change(merged);
    return {
      ...account,
      portfolios: account.portfolios.map((part) =>
        part.locked
          ? part
          : {
              ...part,
              portfolio: {
                ...part.portfolio,
                notifications: next
                  .filter((n) => n.id.startsWith(`${part.id}::`))
                  .map((n) => ({ ...n, id: n.id.slice(part.id.length + 2), title: n.title.replace(`${part.name} · `, '') })),
              },
            },
      ),
    };
  }
  const targetId = account.portfolios.length === 1 ? account.portfolios[0].id : scope;
  const found = account.portfolios.find((part) => part.id === targetId);
  if (!found) throw new Error('Choose a portfolio first.');
  if (found.locked) throw new Error('That portfolio is locked.');
  return {
    ...account,
    portfolios: account.portfolios.map((part) =>
      part.id === targetId ? { ...part, portfolio: { ...part.portfolio, notifications: change(part.portfolio.notifications ?? []) } } : part,
    ),
  };
}

/** Payouts still expected: soonest book closure first, at most three. Amounts are what the ledger already calculated. */
function upcomingDividends(portfolio: ReturnType<typeof dashboardPortfolio>) {
  return (portfolio.dividends ?? [])
    .filter((d) => !d.voided && (d.status ?? 'expected') === 'expected')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)
    .map((d) => ({ ticker: d.ticker, bookClosure: d.date, amount: d.netAmount ?? d.grossAmount ?? null, paymentDate: d.paymentDate ?? null }));
}

const PKT_OFFSET_SECONDS = 5 * 3600;
const pktDay = (seconds: number) => new Date((seconds + PKT_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);

/** Day gain or loss over the holdings that have both a price and a previous close, plus the biggest mover each way. */
function dayMove(held: Holding[], histories: Record<string, number[][]>) {
  const rows: { ticker: string; change: number; percent: number; value: number }[] = [];
  let open = 0;
  for (const h of held) {
    if (h.shares <= 0) continue;
    open += 1;
    const price = h.quote?.price;
    const closes = histories[h.ticker] ? parseEod(histories[h.ticker]) : [];
    const day = h.quote?.date ?? '';
    const before = closes.filter((point) => (day ? pktDay(point[0]) < day : true));
    const previous = before.length ? before[before.length - 1][1] : null;
    if (!price || !previous) continue;
    rows.push({ ticker: h.ticker, change: h.shares * (price - previous), percent: ((price - previous) / previous) * 100, value: h.shares * price });
  }
  if (rows.length === 0) return { available: false, counted: 0, of: open };
  const amount = rows.reduce((sum, r) => sum + r.change, 0);
  const base = rows.reduce((sum, r) => sum + r.value - r.change, 0);
  const byPercent = [...rows].sort((a, b) => b.percent - a.percent);
  const gainer = byPercent[0].percent > 0 ? byPercent[0] : null;
  const loser = byPercent[byPercent.length - 1].percent < 0 ? byPercent[byPercent.length - 1] : null;
  const pick = (r: { ticker: string; change: number; percent: number } | null) => (r ? { ticker: r.ticker, change: r.change, percent: r.percent } : null);
  return { available: true, counted: rows.length, of: open, amount, base, percent: base > 0 ? (amount / base) * 100 : 0, gainer: pick(gainer), loser: pick(loser) };
}

/** Funds, gold, silver and savings plans are priced once a day or two behind, so their move is taken over three days. */
const ASSET_MOVE_DAYS = 3;
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * What the non-stock assets of one portfolio gained or lost over the last three days: what was held three days ago,
 * valued at today's price against the price then, so a purchase made since does not count as a gain.
 */
function assetsMove(assets: Asset[], asOf: string) {
  const ref = shiftDay(asOf, -ASSET_MOVE_DAYS);
  let amount = 0;
  let base = 0;
  let counted = 0;
  for (const asset of assets) {
    if (asset.kind === 'currency') continue;
    const held = {
      ...asset,
      entries: (asset.entries as { date: string }[]).filter((e) => e.date <= ref),
      ...(asset.kind === 'plan' ? { valuations: asset.valuations.filter((v) => v.date <= ref) } : {}),
    } as Asset;
    if (!(held.entries as unknown[]).length) continue;
    const before = valueAsset(held, metalRates, ref, fundNavs, planNavs).value;
    const now = valueAsset(held, metalRates, asOf, fundNavs, planNavs).value;
    if (before === null || now === null || before <= 0) continue;
    amount += now - before;
    base += before;
    counted += 1;
  }
  return { amount, base, counted };
}

/** A portfolio's move: stocks on the last trading day, the other assets over three days. */
function portfolioMove(part: { portfolio: ReturnType<typeof dashboardPortfolio> }, histories: Record<string, number[][]>) {
  const stocks = dayMove(safeHoldings(part.portfolio).held, histories);
  const others = assetsMove(part.portfolio.assets ?? [], today());
  const amount = (stocks.available ? stocks.amount ?? 0 : 0) + others.amount;
  const base = (stocks.available ? stocks.base ?? 0 : 0) + others.base;
  if (!stocks.available && others.counted === 0) return { available: false };
  return { available: true, counted: (stocks.counted ?? 0) + others.counted, of: 0, amount, percent: base > 0 ? (amount / base) * 100 : 0 };
}

const handlers: Record<string, Handler> = {
  'engine.version': () => ENGINE_API_VERSION,

  // Account rules the vault uses before it stores anything (core:session AccountRules).
  'account.blank': () => accountFromPortfolio(),
  'account.normalize': (args) => normalizeAccount(JSON.parse(text(args, 'json')), false),
  'account.assertWritable': (args) => {
    assertAccountWritable(normalizeAccount(JSON.parse(text(args, 'current')), false), normalizeAccount(JSON.parse(text(args, 'next')), false));
    return true;
  },

  // Keeps the decrypted account in the isolate; dropped on lock when the isolate is closed.
  'account.load': (args) => {
    loaded = normalizeAccount(JSON.parse(text(args, 'json')), false);
    return { portfolios: loaded.portfolios.map((p) => ({ id: p.id, name: p.name, locked: Boolean(p.locked) })) };
  },
  'account.unload': () => {
    loaded = null;
    overlaid = null;
    overlay = { quoteRows: [], announcements: [], faceValues: {}, lookups: [] };
    return true;
  },

  // Tickers the public lookups need, and the companies whose name or sector is still a placeholder.
  'public.wanted': () => {
    const account = requireAccount();
    const tickers = [...new Set(account.portfolios.flatMap((x) => x.portfolio.companies.map((c) => c.ticker)))];
    const placeholders = [...new Set(account.portfolios.flatMap((x) => x.portfolio.companies.filter(hasPlaceholderDetails).map((c) => c.ticker)))];
    return { tickers, placeholders };
  },

  // The companies a manual price refresh covers: everything held or targeted, plus the Monthly Picks shortlist.
  'prices.tickers': () => ({
    tickers: [...new Set(requireAccount().portfolios.flatMap((x) => priceTickers(x.portfolio)))],
  }),

  // Starts a fresh round of public data; parts are added with public.add, company details with public.lookups.
  'public.reset': () => {
    overlay = { quoteRows: [], announcements: [], faceValues: {}, lookups: overlay.lookups };
    overlayVersion++;
    return true;
  },
  'public.add': (args) => {
    const part = JSON.parse(text(args, 'json')) as Partial<Overlay>;
    overlay = {
      ...overlay,
      quoteRows: [...overlay.quoteRows, ...(part.quoteRows ?? [])],
      announcements: [...overlay.announcements, ...(part.announcements ?? [])],
      faceValues: { ...overlay.faceValues, ...(part.faceValues ?? {}) },
    };
    overlayVersion++;
    return true;
  },
  'public.lookups': (args) => {
    overlay = { ...overlay, lookups: JSON.parse(text(args, 'json')) as unknown[] };
    overlayVersion++;
    return true;
  },

  // Automatic dividends from the announcements, for unlocked portfolios. Returns the next account when something
  // changed; the app saves it (revision-checked) like any other change.
  'dividends.sync': () => {
    const account = requireAccount();
    let changed = false;
    const portfolios = account.portfolios.map((entry) => {
      if (entry.locked) return entry;
      const update = planAutoDividendUpdate(entry.portfolio, overlay.announcements as never, undefined, undefined, overlay.faceValues as never);
      if (!update) return entry;
      changed = true;
      return { ...entry, portfolio: update.next };
    });
    return changed ? { changed, account: JSON.stringify({ ...account, portfolios }) } : { changed };
  },

  // The Holdings screen: sorted, filtered rows plus the headline numbers, for one portfolio or all of them.
  'holdings.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const sort = (typeof args.sort === 'string' ? args.sort : 'value') as HoldingSort;
    const sector = typeof args.sector === 'string' && args.sector ? args.sector : null;
    const portfolio = dashboardPortfolio(viewAccount(), scope);
    const { held, error } = safeHoldings(portfolio);
    const open = openPositions(held);
    const summary = totals(held);
    const flags = holdingFlags(portfolio, open, today());
    const row = (h: Holding) => ({
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      shares: h.shares,
      average: h.average,
      price: h.quote?.price ?? null,
      priceDate: h.quote?.date ?? null,
      value: h.value,
      cost: h.cost,
      gain: h.gain,
      gainPercent: h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100,
      weight: weightOf(h, summary.value),
      stale: flags.get(h.ticker)?.stale ?? false,
      expectedDividend: flags.get(h.ticker)?.expectedDividend ?? false,
    });
    return {
      rows: filterBySector(sortHoldings(open, sort), sector).map(row),
      soldOut: soldOutPositions(portfolio, held).map(row),
      sectors: sectorsOf(open),
      summary,
      error,
    };
  },

  // Public gold, silver and fund prices (they have no parameters, so they say nothing about what is held).
  'rates.set': (args) => {
    metalRates = typeof args.metals === 'string' && args.metals ? (JSON.parse(args.metals) as MetalRateRow[]) : metalRates;
    fundNavs = typeof args.navs === 'string' && args.navs ? (JSON.parse(args.navs) as FundNavRow[]) : fundNavs;
    planNavs = typeof args.plans === 'string' && args.plans ? (JSON.parse(args.plans) as PlanNavRow[]) : planNavs;
    fxRates = typeof args.fx === 'string' && args.fx ? (JSON.parse(args.fx) as FxRateRow[]) : fxRates;
    return { metals: metalRates.length, navs: fundNavs.length, fx: fxRates.length };
  },
  'rates.wanted': () => {
    const assets = requireAccount().portfolios.flatMap((x) => x.portfolio.assets ?? []);
    return {
      metals: assets.some((a) => a.kind === 'metal'),
      funds: assets.some((a) => a.kind === 'fund'),
      fx: assets.some((a) => a.kind === 'currency'),
      plans: assets.some((a) => a.kind === 'plan'),
      fundIds: [...new Set(assets.flatMap((a) => (a.kind === 'fund' ? [a.mufapId] : [])))],
    };
  },

  // Net worth for the chosen portfolio (or all): asset mix, portfolios, holdings, sectors, income and money-weighted return.
  'overview.view': (args) => {
    const parts = scopeParts(args);
    return parts.length ? accountOverview(parts, today(), { metalRates, fundNavs, fxRates }) : null;
  },

  // Gold and silver, savings plans and mutual funds in the chosen scope (read-only on the phone).
  'assets.view': (args) => {
    const parts = scopeParts(args);
    const asOf = today();
    const labelled = parts.length > 1;
    const owned = parts.flatMap((part) => (part.portfolio.assets ?? []).map((asset) => ({ asset, portfolio: labelled ? part.name : '' })));
    const metals = owned.flatMap((o) => (o.asset.kind === 'metal' ? [{ asset: o.asset as MetalAsset, portfolio: o.portfolio }] : []));
    const funds = owned.flatMap((o) => (o.asset.kind === 'fund' ? [{ asset: o.asset as FundAsset, portfolio: o.portfolio }] : []));
    const plans = owned.flatMap((o) => (o.asset.kind === 'plan' ? [{ asset: o.asset as PlanAsset, portfolio: o.portfolio }] : []));
    const currencies = owned.flatMap((o) => (o.asset.kind === 'currency' ? [{ asset: o.asset as CurrencyAsset, portfolio: o.portfolio }] : []));
    return {
      currencies: currencies.map(({ asset, portfolio }) => {
        const v = valueCurrency(asset, fxRates, asOf);
        return {
          id: asset.id,
          name: asset.name,
          currency: asset.currency,
          heldAt: asset.heldAt ?? '',
          portfolio,
          units: v.units,
          value: v.value,
          gain: v.gain,
          cost: v.cost,
          realized: v.realized,
          rate: v.rate ? { pkrPerUnit: v.rate.pkrPerUnit, kind: v.rate.kind, date: v.rate.date, stale: v.rate.stale } : null,
        };
      }),
      metals: metals.map(({ asset, portfolio }) => {
        const v = valueMetal(asset, metalRates, asOf);
        const recent = [...v.history].reverse().slice(0, 3);
        return {
          id: asset.id,
          name: asset.name,
          portfolio,
          grams: v.grams,
          tola: tolaFromGrams(v.grams),
          value: v.value,
          gain: v.gain,
          costKnown: v.cost !== null,
          boughtGrams: v.bought.grams,
          soldGrams: v.sold.grams,
          realized: v.realized,
          recent: recent.map((e) => ({ id: e.id, date: e.date, kind: e.type, pieces: describePieces(e), amount: e.amount })),
          olderCount: Math.max(0, v.history.length - recent.length),
          rate: v.rate ? { pkrPerTola: v.rate.pkrPerTola, kind: v.rate.kind, date: v.rate.date } : null,
        };
      }),
      funds: funds.map(({ asset, portfolio }) => {
        const v = valueFund(asset, fundNavs, asOf);
        return { id: asset.id, name: asset.name, amc: asset.amc, portfolio, units: v.units, value: v.value, gain: v.gain, cost: v.cost, price: v.price };
      }),
      plans: plans.map(({ asset, portfolio }) => {
        const v = planValue(asset, asOf);
        const due = dueEntries(asset, asOf);
        return {
          id: asset.id,
          name: asset.name,
          portfolio,
          closed: Boolean(asset.closed),
          value: v.value,
          gain: v.gain,
          contributed: v.contributed,
          redeemed: v.redeemed,
          cost: v.cost,
          source: v.source,
          statementDate: v.statementDate ?? '',
          dueCount: due.length,
          dueAmount: due[0]?.amount ?? 0,
        };
      }),
    };
  },

  // The Today screen: headline figures, return breakdown, this month's progress and the next actions.
  'today.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const month = typeof args.month === 'string' && args.month ? args.month : currentMonth();
    const now = today();
    const account = viewAccount();
    const portfolio = dashboardPortfolio(account, scope);
    const { held, error } = safeHoldings(portfolio);
    const summary = totals(held);
    const open = openPositions(held);
    const hasStocks = portfolio.companies.length > 0 || portfolio.trades.length > 0 || (portfolio.dividends ?? []).length > 0;
    const hasAssets = scopeParts(args).some((part) => (part.portfolio.assets ?? []).length > 0);
    return {
      now,
      month,
      summary,
      openCount: open.length,
      error,
      hasStocks,
      hasAssets,
      firstUse: !hasStocks && !hasAssets,
      breakdown: returnBreakdown(portfolio, summary.gain),
      progress: monthProgress(portfolio, month),
      actions: nextActions(portfolio, held, month, now, 3, { planSource: planPortfolio(account, scope), dividends: false }),
      upcoming: upcomingDividends(portfolio),
    };
  },

  // How much the holdings moved on the last trading day, from each price against the close before it.
  'today.move': (args) => {
    const portfolio = dashboardPortfolio(viewAccount(), typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS);
    const histories = JSON.parse(text(args, 'histories')) as Record<string, number[][]>;
    return dayMove(safeHoldings(portfolio).held, histories);
  },

  // The move of each portfolio on its own, for the Portfolios card: stocks over the last trading day, funds, gold and
  // plans over three days. A locked portfolio has nothing to count.
  'today.portfolioMoves': (args) => {
    const histories = JSON.parse(text(args, 'histories')) as Record<string, number[][]>;
    return viewAccount().portfolios.map((part) => ({
      id: part.id,
      move: part.locked ? { available: false } : portfolioMove(part, histories),
    }));
  },

  // The Activity ledger: filtered, searched and grouped by month, newest first.
  'activity.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const filter = (typeof args.filter === 'string' ? args.filter : 'all') as ActivityFilter;
    const query = typeof args.query === 'string' ? args.query : '';
    const entries = filterActivity(activityEntries(dashboardPortfolio(viewAccount(), scope)), filter, query);
    return { count: entries.length, sections: groupByMonth(entries) };
  },

  // One company: position, expected and received dividends, and its ledger lines.
  'company.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const ticker = text(args, 'ticker').toUpperCase();
    const portfolio = dashboardPortfolio(viewAccount(), scope);
    const { held, error } = safeHoldings(portfolio);
    const h = held.find((x) => x.ticker === ticker);
    if (!h) return { found: false, error };
    const saved = portfolio.quotes[ticker];
    return {
      found: true,
      ticker,
      name: h.name,
      sector: h.sector,
      shares: h.shares,
      average: h.average,
      cost: h.cost,
      value: h.value,
      gain: h.gain,
      gainPercent: h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100,
      realized: h.realized,
      price: h.quote?.price ?? null,
      priceDate: h.quote?.date ?? null,
      priceManual: Boolean(h.quote?.manual),
      hiddenQuoteDate: !h.quote && saved ? saved.date : null,
      portfolios: viewAccount()
        .portfolios.filter((x) => x.portfolio.companies.some((c) => c.ticker === ticker))
        .map((x) => ({ id: x.id, name: x.name, locked: Boolean(x.locked) })),
      dividends: companyDividends(portfolio, ticker),
      entries: activityEntries(portfolio, ticker),
      held: h.shares > 0,
      weight: weightInStocks(portfolio, h.value),
      realisedProfit: realisedProfit(portfolio, ticker),
      payments: dividendPayments(portfolio, ticker),
      markers: tradeMarkers(portfolio.trades, ticker, 0, Number.MAX_SAFE_INTEGER, money),
    };
  },

  /**
   * The key-statistics card from public data only: the `/api/company-stats` answer, the day quote the market summary
   * gave, and the price history already loaded. Values come back formatted, so the phone prints what the web prints.
   */
  'company.stats': (args) => {
    const stats = args.stats ? (JSON.parse(text(args, 'stats')) as { stats?: CompanyStats }).stats ?? null : null;
    const day = args.day ? (JSON.parse(text(args, 'day')) as Parameters<typeof keyStats>[0]['day']) : undefined;
    const history = args.history ? (JSON.parse(text(args, 'history')) as { eod?: number[][]; intraday?: number[][] }) : {};
    const ticker = text(args, 'ticker').toUpperCase();
    // An "assume Rs 10" face value is the account's own guess, so it never feeds a published-looking yield.
    const company = viewAccount()
      .portfolios.flatMap((x) => x.portfolio.companies)
      .find((c) => c.ticker === ticker && !c.faceValueAssumed);
    const { left, right } = keyStats({
      stats,
      day,
      eod: parseEod(history.eod ?? []) as unknown as [number, number][],
      intraday: parseIntraday(history.intraday ?? []) as unknown as [number, number][],
      company,
      faceValueAt: faceValueFor,
      todayIso: today(),
    });
    const rows = (list: typeof left) => list.map((row) => ({ label: row.label, value: formatStat(row) }));
    return { left: rows(left), right: rows(right) };
  },

  // A price-history response cut to one chart range, with its change over the range.
  'history.series': (args) => {
    const data = JSON.parse(text(args, 'json')) as { eod?: number[][]; intraday?: number[][] };
    const points = sliceRange(parseEod(data.eod ?? []), parseIntraday(data.intraday ?? []), text(args, 'range') as HistoryRange);
    return { points, change: rangeChange(points) };
  },

  // The Plan tab (targets mode): one plan for the whole account, the month's buys and the review rows.
  'plan.view': (args) => {
    const account = viewAccount();
    const now = currentMonth();
    const month = typeof args.month === 'string' && args.month ? args.month : now;
    const feePct = typeof args.feePct === 'string' ? (parseNumber(args.feePct) ?? 0) : 0;
    const allowOld = args.allowOld === 'true';
    const unified = account.portfolios.length > 1 ? unifiedPlanSource(account) : null;
    const home = unified ? unified.home : account.portfolios[0];
    const portfolio = unified ? unified.portfolio : dashboardPortfolio(account, home.id);
    const { plan: result, error } = buildPlan(portfolio, month, feePct, allowOld);
    const targeted = portfolio.companies.filter((c) => c.target > 0);
    const budgetSet = portfolio.budgets[month] !== undefined;
    const planErrors = (result?.errors ?? []).filter((e) => e !== 'Target weights must total 100%.');
    const buys = result && budgetSet && !result.errors.length ? result.rows.filter((r) => r.shares > 0 && r.price !== null) : [];
    return {
      now,
      month,
      homeId: home.id,
      readOnly: Boolean(home.locked) || month < now,
      receivers: unified ? account.portfolios.filter((x) => !x.locked).map((x) => ({ id: x.id, name: x.name })) : [],
      companyCount: portfolio.companies.length,
      targetedCount: targeted.length,
      targetState: targetTotals(targeted.map((c) => ({ ticker: c.ticker, target: c.target }))),
      budgetSet,
      budget: budgetSet ? portfolio.budgets[month] : null,
      error,
      planErrors,
      plan: result,
      buys,
      bought: monthBuys(portfolio, month),
    };
  },

  // ───────────────────────── SIP Blueprint (the new Plan tab) ─────────────────────────

  /**
   * The whole SIP Blueprint screen for the running month: hero wording, one row per class with what to do next, the
   * habit strip and the month's figures — exactly what the web page shows. `setup: true` while no plan exists yet,
   * with what the wizard needs to open.
   */
  'sip.view': (args) => {
    const account = viewAccount();
    const parts = account.portfolios;
    const asOf = isoOr(args.asOf, today());
    const b = accountSipBlueprint(account);
    const canLog = parts.some((p) => !p.locked);
    if (!b) {
      return {
        setup: true,
        asOf,
        month: asOf.slice(0, 7),
        canLog,
        classes: SIP_CLASSES,
        labels: SIP_CLASS_LABELS,
        budgetPills: SIP_BUDGET_PILLS,
        presets: SIP_PRESET_ORDER.map((key) => {
          const preset = key === 'custom' ? null : SIP_PRESETS[key];
          const targets = presetTargets(key, SIP_PRESETS.balanced.targets);
          return {
            key,
            label: preset?.label ?? 'Custom',
            blurb: preset?.blurb ?? 'Set your own split.',
            targets,
            annual: blendedReturn(targets),
          };
        }),
        blank: blankBlueprint(asOf.slice(0, 7)),
      };
    }
    const view = sipView(b, parts, asOf, sipRates(), { canLog });
    return {
      setup: false,
      asOf,
      canLog,
      classes: SIP_CLASSES,
      labels: SIP_CLASS_LABELS,
      budgetPills: SIP_BUDGET_PILLS,
      streakThreshold: STREAK_THRESHOLD,
      blueprint: b,
      annual: blendedReturn(b.targets, { ...DEFAULT_RETURNS, ...b.returns }),
      hero: view.hero,
      rows: view.rows,
      state: view.state,
      edited: view.edited,
      strict: view.strict,
      day: view.day,
    };
  },

  /**
   * The live answer under the setup wizard and the edit sheet for a draft that is not saved yet: this month's split,
   * the mix it would leave, the blended return and where ten years of it lands.
   */
  'sip.preview': (args) => {
    const asOf = isoOr(args.asOf, today());
    const draft = JSON.parse(text(args, 'draft')) as { budget: number; targets: Record<SipClass, number>; strict?: boolean };
    const targets = {} as Record<SipClass, number>;
    for (const k of SIP_CLASSES) targets[k] = Number(draft.targets?.[k] ?? 0);
    const budget = Number(draft.budget) || 0;
    const held = classWeights(viewAccount().portfolios, asOf, sipRates());
    const plan = planMonth(budget, targets, held.weights, draft.strict === true);
    const total = targetsTotal(targets);
    const annual = blendedReturn(targets);
    const decade = projectSip({ monthly: budget, years: 10, annualPct: annual, stepUpPct: 10 });
    const in10 = decade[decade.length - 1] ?? null;
    return {
      plan,
      total,
      valid: budget > 0 && total === 100,
      annual,
      mix: mixAfter(held.values, plan),
      held: { values: held.values, weights: held.weights, total: held.total },
      in10: in10 ? { invested: in10.invested, value: in10.value, label: lakh(in10.value) } : null,
      hints: Object.fromEntries(SIP_CLASSES.map((k) => [k, rowHint(k, plan[k], sipRates(), asOf)])),
    };
  },

  /**
   * "Future you": where this plan lands, in money of the day and in today's money, with the milestones it passes and
   * what skipping one month a year costs.
   */
  'sip.project': (args) => {
    const account = viewAccount();
    const b = accountSipBlueprint(account);
    const nOr = (key: string, fallback: number) => {
      const v = args[key];
      const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
      return Number.isFinite(n) ? n : fallback;
    };
    const monthly = nOr('monthly', b?.budget ?? SIP_BUDGET_PILLS[1]);
    const years = Math.min(MAX_LOOK_AHEAD, Math.max(1, Math.round(nOr('years', 15))));
    const stepUp = nOr('stepUp', b?.stepUp ?? 10);
    const returns = { ...DEFAULT_RETURNS, ...b?.returns } as Record<SipClass, number>;
    if (args.returns) {
      const typed = JSON.parse(text(args, 'returns')) as Record<string, number>;
      for (const k of SIP_CLASSES) if (Number.isFinite(typed[k])) returns[k] = typed[k];
    }
    const targets = b?.targets ?? blankBlueprint(today().slice(0, 7)).targets;
    const annual = blendedReturn(targets, returns);
    // What the SIP classes are worth today; the projection starts from it unless the person switched that off.
    const held = Math.round(classWeights(account.portfolios, today(), sipRates()).total);
    const startValue = args.startFromHoldings === 'false' ? 0 : held;
    const real = args.real === 'true';
    const startYear = Number(today().slice(0, 4));
    const base = { monthly, annualPct: annual, stepUpPct: stepUp, inflationPct: LONG_RUN_INFLATION, startValue };
    const points = projectSip({ ...base, years });
    const last = points[points.length - 1];
    const levels = [1e6, 5e6, 1e7, 2.5e7, 5e7, 1e8];
    const tone = (n: number) => (Math.abs(n) < 1 ? 'same' : n > 0 ? 'up' : 'down');
    const change = (n: number) => (Math.abs(n) < 1 ? 'same' : `${n > 0 ? '+' : '-'}${lakh(Math.abs(n))}`);
    const lineView = (l: ScenarioLine, plan: ScenarioLine) => ({
      key: l.key,
      label: l.label,
      levers: l.levers,
      points: l.points,
      valueLabel: lakh(l.summary.value),
      investedLabel: lakh(l.summary.invested),
      growthLabel: lakh(l.summary.growth),
      multipleLabel: l.summary.multiple === null ? '' : `Rs ${l.summary.multiple.toFixed(1)}`,
      reachedYear: l.summary.yearReached === null ? null : startYear + l.summary.yearReached,
      deltaLabel: l.delta ? change(l.delta.value) : '',
      deltaTone: l.delta ? tone(l.delta.value) : 'same',
      checkpoints: l.summary.checkpoints.map((c, i) => {
        const d = c.value - plan.summary.checkpoints[i].value;
        return { year: c.year, valueLabel: lakh(c.value), deltaLabel: l.delta ? change(d) : '', deltaTone: l.delta ? tone(d) : 'same' };
      }),
    });
    const whatIfs = args.whatIfs ? (JSON.parse(text(args, 'whatIfs')) as { key: string; levers: SipLevers; label?: string }[]) : [];
    const cmp = whatIfs.length ? compareScenarios(base, whatIfs, years, { real, startYear }) : null;
    const goalArg = args.goal ? (JSON.parse(text(args, 'goal')) as { target: number; year?: number | null }) : null;
    let goal = null;
    if (goalArg && goalArg.target > 0) {
      const deadline = goalArg.year ? goalArg.year - startYear : undefined;
      const g = goalWays(base, goalArg.target, deadline && deadline >= 1 && deadline <= 50 ? deadline : undefined);
      const horizon = Math.min(MAX_LOOK_AHEAD + 10, Math.max(5, (g.deadlineYears ?? g.yearsToReach ?? 20) + 1));
      const lines: { name: string; dashed: boolean; points: ReturnType<typeof projectScenario> }[] = [
        { name: 'Your plan', dashed: true, points: projectScenario(base, {}, horizon) },
      ];
      if (g.deadlineYears !== undefined && !g.onTrack) {
        if (g.monthlyNeeded) lines.push({ name: `${lakh(g.monthlyNeeded)} a month`, dashed: false, points: projectScenario(base, { monthly: g.monthlyNeeded }, horizon) });
        if (g.stepUpNeeded) lines.push({ name: `Raise ${g.stepUpNeeded}% a year`, dashed: false, points: projectScenario(base, { stepUp: g.stepUpNeeded }, horizon) });
      }
      goal = {
        ...g,
        takeaway: goalTakeaway(g, startYear),
        targetLabel: lakh(g.target),
        monthlyLabel: g.monthlyNeeded === null || g.monthlyNeeded === undefined ? '' : lakh(g.monthlyNeeded),
        monthlyMoreLabel: g.monthlyNeeded ? lakh(Math.max(0, g.monthlyNeeded - monthly)) : '',
        reachedYear: g.yearsToReach === null ? null : startYear + g.yearsToReach,
        lines,
      };
    }
    return {
      monthly,
      years,
      stepUp,
      returns,
      annual,
      inflation: LONG_RUN_INFLATION,
      defaults: DEFAULT_RETURNS,
      startYear,
      held,
      startValue,
      points,
      last,
      marks: {
        nominal: marked(points.map((p) => ({ year: p.year, value: p.value })), levels),
        real: marked(points.map((p) => ({ year: p.year, value: p.realValue })), levels),
      },
      skip: {
        nominal: skipCost(monthly, years, annual),
        real: skipCost(monthly, years, annual) / Math.pow(1 + LONG_RUN_INFLATION / 100, years),
      },
      presets: scenarioPresets(base),
      comparison: cmp ? { years: cmp.years, takeaway: cmp.takeaway, lines: cmp.lines.map((l) => lineView(l, cmp.lines[0])) } : null,
      goal,
    };
  },

  /**
   * One stepper move on this month's plan: the amount the person set for a class, with the difference spread over the
   * rows that are not ticked off yet. Returns the next plan and the mix it leaves, for the sheet to show before saving.
   */
  'sip.rebalance': (args) => {
    const account = viewAccount();
    const b = accountSipBlueprint(account);
    if (!b) throw new Error('Set up your SIP first.');
    const asOf = isoOr(args.asOf, today());
    const key = text(args, 'class') as SipClass;
    if (!SIP_CLASSES.includes(key)) throw new Error('Which class?');
    const amount = Number(text(args, 'amount'));
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter an amount.');
    const st = sipView(b, account.portfolios, asOf, sipRates()).state;
    const current = args.plan ? (JSON.parse(text(args, 'plan')) as Record<SipClass, number>) : st.plan;
    const locked = SIP_CLASSES.filter((c) => st.done[c]);
    const plan = rebalanceEdit(current, key, amount, st.budget, b.targets, locked);
    return {
      plan,
      locked,
      budget: st.budget,
      suggested: st.suggested,
      total: SIP_CLASSES.reduce((n, k) => n + plan[k], 0),
      mix: mixAfter(st.values, plan),
      hints: Object.fromEntries(SIP_CLASSES.map((k) => [k, rowHint(k, plan[k], sipRates(), asOf)])),
    };
  },

  // The review sheet's live total and row problems for the typed shares and prices.
  'buys.review': (args) => {
    const rows = JSON.parse(text(args, 'rows')) as ReviewRow[];
    const feePct = typeof args.feePct === 'string' ? (parseNumber(args.feePct) ?? 0) : 0;
    return parseReview(rows, feePct);
  },

  // The targets editor's starting point: the home portfolio's targets and the companies that could be added.
  'targets.view': () => {
    const account = requireAccount();
    const home = account.portfolios[0];
    return {
      homeId: home.id,
      locked: Boolean(home.locked),
      today: today(),
      cap: WEIGHT_CAP,
      rows: targetRows(home.portfolio).map((r) => ({ ticker: r.ticker, weight: String(r.target), approved: r.approved, screenDate: r.screenDate })),
      companies: home.portfolio.companies.map((c) => ({ ticker: c.ticker, name: c.name, sector: c.sector })),
    };
  },

  // Live totals and per-row screening status for the typed draft.
  'targets.eval': (args) => {
    const rows = JSON.parse(text(args, 'rows')) as { ticker: string; weight: string; approved: boolean; screenDate: string }[];
    const weight = (t: string) => parseNumber(t) ?? 0;
    return {
      totals: targetTotals(rows.map((r) => ({ ticker: r.ticker, target: weight(r.weight) }))),
      statuses: Object.fromEntries(rows.map((r) => [r.ticker, screenStatus({ approved: r.approved, screenDate: r.screenDate })])),
    };
  },

  'targets.even': (args) => evenWeights(Number(text(args, 'count'))),

  'targets.search': (args) => {
    const home = requireAccount().portfolios[0].portfolio;
    const taken = new Set(JSON.parse(text(args, 'taken')) as string[]);
    const found = searchCompanies(home.companies.filter((c) => !taken.has(c.ticker)), typeof args.query === 'string' ? args.query : '');
    return { total: found.length, items: found.slice(0, 8).map((c) => ({ ticker: c.ticker, name: c.name, sector: c.sector })) };
  },

  // One existing entry, to correct or void it. [id] may be `portfolio::entry` when portfolios are merged.
  'entry.get': (args) => {
    const account = requireAccount();
    const full = text(args, 'id');
    const at = full.indexOf('::');
    const portfolioId = at >= 0 ? full.slice(0, at) : account.portfolios[0].id;
    const id = at >= 0 ? full.slice(at + 2) : full;
    const owner = account.portfolios.find((x) => x.id === portfolioId);
    if (!owner) return { found: false };
    const p = owner.portfolio;
    const readOnly = owner.locked ? 'This portfolio is locked. Unlock it in Settings → Portfolios.' : readOnlyReason(p, id);
    const base = { found: true, portfolioId, id, readOnly };
    const t = p.trades.find((x) => x.id === id);
    if (t) {
      return {
        ...base,
        entryKind: 'trade',
        kind: t.kind,
        ticker: t.ticker,
        date: t.date,
        shares: String(t.shares),
        price: t.price === null ? '' : String(t.price),
        fees: t.fees ? String(t.fees) : '',
        month: t.month,
        note: t.note,
      };
    }
    const d = p.dividends?.find((x) => x.id === id);
    if (d) return { ...base, entryKind: 'dividend', kind: 'dividend', ticker: d.ticker, date: d.date, perShare: d.perShare ? String(d.perShare) : '', note: d.note };
    const sp = p.stockSplits?.find((x) => x.id === id);
    if (sp) {
      return { ...base, entryKind: 'split', kind: 'split', ticker: sp.ticker, date: sp.date, oldShares: String(sp.oldShares), newShares: String(sp.newShares), note: sp.note };
    }
    return { found: false };
  },

  // The portfolio chooser: every portfolio with what it holds, in words.
  'scope.list': () => ({
    portfolios: viewAccount().portfolios.map((x, _i, all) => ({
      id: x.id,
      name: x.name,
      locked: Boolean(x.locked),
      contents: contentsLabel(portfolioContents(x.portfolio)),
      // Only an empty, unlocked portfolio can go, and never the last one.
      canDelete: x.id !== LEGACY_PORTFOLIO_ID && !x.locked && !hasFinancialRecords(x.portfolio) && all.length > 1,
    })),
  }),

  // Monthly Picks: the shortlist, the amount, the newest run for the month and its estimated buys.
  'picks.view': (args) => {
    const account = viewAccount();
    const home = account.portfolios[0];
    const portfolio = home.portfolio;
    const month = typeof args.month === 'string' && args.month ? args.month : currentMonth();
    const shortlist = initialShortlist(portfolio);
    const current = portfolio.monthlyPicksRuns?.find((r) => r.month === month) ?? null;
    const counts = portfolioCounts(portfolio, shortlist);
    let estimateError: string | null = null;
    let picks: unknown[] = [];
    if (current?.result && current.status === 'completed') {
      try {
        picks = estimateMonthlyPicks(current.result, portfolio, current.amount, current.feePct).map((e) => ({
          ticker: e.ticker, name: e.name, allocationPct: e.allocationPct, allocationPkr: e.allocationPkr, confidence: e.confidence,
          thesis: e.thesis, risks: e.risks, evidence: (e.evidenceRefs ?? []).map((r) => ({ label: r.label, value: r.value })),
          sources: pickSources(e), price: e.price, shares: e.shares, estimatedSpend: e.estimatedSpend,
        }));
      } catch (e) {
        estimateError = e instanceof Error ? e.message : 'Could not work out share counts.';
      }
    }
    return {
      portfolioId: home.id,
      locked: Boolean(home.locked),
      readOnly: Boolean(home.locked) || month < currentMonth(),
      month,
      max: MAX_SHORTLIST,
      shortlist,
      budget: portfolio.budgets[month] ?? null,
      counts: { saved: counts.savedCompanies, held: counts.holdings, shortlisted: counts.shortlisted },
      targeted: portfolio.companies.filter((c) => c.target > 0).map((c) => c.ticker).slice(0, MAX_SHORTLIST),
      companies: portfolio.companies.map((c) => ({ ticker: c.ticker, name: c.name })),
      run: current
        ? {
            status: current.status, error: current.error, amount: current.amount, feePct: current.feePct, dataAsOf: current.dataAsOf,
            marketOutlook: current.result?.marketOutlook ?? '', fallbackReason: current.result?.fallbackReason ?? null,
            unallocatedPct: current.result?.unallocatedPct ?? 0, sizing: explainSizing(current.result?.sizing),
          }
        : null,
      picks,
      estimateError,
    };
  },

  // Which shortlisted companies still need a fresh PSX company-data scrape, from a public-analysis response.
  'picks.stale': (args) => {
    const raw = JSON.parse(text(args, 'json')) as Record<string, unknown>;
    const parsed = parsePublicAnalysis(raw);
    if (!parsed) throw new Error('The company data response was not understood.');
    const stale = parsed.facts.filter((f) => needsScrape(classifyFacts(f.ticker, f.fetchedOn, null, parsed.dataAsOf))).map((f) => f.ticker);
    const waiting = (typeof args.stale === 'string' ? (JSON.parse(args.stale) as string[]) : []).filter((t) => parsed.facts.some((f) => f.ticker === t && f.state !== 'fresh'));
    return { stale, waiting, dispatchEnabled: Boolean(raw.dispatchEnabled) };
  },

  'picks.config': () => ({ max: MAX_SHORTLIST, gatherTimeoutMs: GATHER_TIMEOUT_MS, pollFastMs: pollIntervalMs(0), pollSlowMs: pollIntervalMs(60_000) }),

  // Whether the PSX session is open now (the phone polls the market card only then).
  'market.open': () => ({ open: pakistanMarketState(new Date()).isOpen }),

  // The Inbox: dividend announcements and recorded payouts for the chosen scope, filtered, with counts.
  'inbox.view': (args) => {
    const account = viewAccount();
    const portfolio = dashboardPortfolio(account, typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS);
    const list = portfolio.notifications ?? [];
    const names = account.portfolios.map((p) => p.name);
    const tickers = new Set(portfolio.companies.map((c) => c.ticker));
    const filter = (typeof args.filter === 'string' ? args.filter : 'inbox') as NotificationFilter;
    return {
      counts: notificationCounts(list),
      items: filterNotifications(list, filter).map((n) => {
        const from = names.find((name) => n.title.startsWith(`${name} · `)) ?? null;
        return {
          id: n.id,
          at: n.at,
          ticker: n.ticker ?? null,
          title: from ? n.title.slice(from.length + 3) : n.title,
          from: names.length > 1 ? from : null,
          body: n.body,
          read: Boolean(n.read),
          cleared: Boolean(n.clearedAt),
          unread: isUnread(n),
          canOpen: Boolean(n.ticker && tickers.has(n.ticker)),
          expected: Boolean(expectedDividendFor(portfolio, n)),
        };
      }),
    };
  },

  // Insights: the report sections (allocation, sectors, targets, gain by company, buying by month, income).
  'insights.view': (args) => {
    const portfolio = dashboardPortfolio(viewAccount(), typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS);
    const r = portfolioReport(portfolio);
    const s = r.summary;
    return {
      summary: {
        pricedValue: s.pricedValue,
        totalGain: s.totalGain,
        totalGainPercent: s.totalGainPercent,
        grandTotalReturn: s.grandTotalReturn,
        quotesPriced: s.quoteCoverage.priced,
        quotesHeld: s.quoteCoverage.held,
        topThreeWeight: s.topThreeWeight,
        largestSector: s.largestSector ? { name: s.largestSector.sector, weight: s.largestSector.weight } : null,
      },
      companyAllocation: r.companyAllocation.map((a) => ({ label: a.ticker, weight: a.weight })),
      sectorAllocation: r.sectorAllocation.map((a) => ({ label: a.sector, weight: a.weight })),
      targets: r.targetComparison.filter((t) => t.target > 0).map((t) => ({ ticker: t.ticker, actual: t.actual, target: t.target })),
      performance: r.performance.map((p) => ({ ticker: p.ticker, gain: p.gain, gainPercent: p.gainPercent })),
      monthly: r.monthlyActivity.slice(-6).map((m) => ({ month: m.month, invested: m.invested })),
      realized: {
        totalRealizedGain: r.realized.totalRealizedGain,
        dividendsGross: r.realized.totalDividendIncomeGross,
        capitalGainsTax: r.realized.totalCapitalGainsTax,
        taxProfileSet: r.realized.taxProfileSet,
      },
    };
  },

  // The price-history requests the track record needs (the KSE-100 rides in the first batch), as ticker lists.
  'track.batches': (args) => {
    const portfolio = dashboardPortfolio(viewAccount(), typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS);
    const tickers = tradedTickers(portfolio);
    return { empty: tickers.length === 0, batches: tickers.length ? historyBatches(tickers) : [] };
  },

  // Value against money in, the money-weighted return and the KSE-100 comparison, worded for the chosen range.
  'track.view': (args) => {
    const portfolio = dashboardPortfolio(viewAccount(), typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS);
    const range = (typeof args.range === 'string' ? args.range : '1y') as TrackRange;
    const histories = JSON.parse(text(args, 'histories')) as Record<string, number[][]>;
    const { held } = safeHoldings(portfolio);
    const summary = totals(held);
    const missing = summary.missingPrice ?? [];
    const record = buildTrackRecord({
      portfolio,
      histories,
      asOf: today(),
      currentValue: missing.length === 0 ? summary.value : null,
      missingPrice: missing,
    });
    const year = Number(today().slice(0, 4));
    return {
      value: valueChartView(record.value, range, year),
      mwr: returnView(record.mwr, record.block),
      benchmark: benchmarkView(record.benchmark, range, year, record.benchmarkBlock),
    };
  },

  // Account-wide settings the Settings screen shows.
  'settings.view': () => ({ filerStatus: accountTaxProfile(requireAccount())?.filerStatus ?? '' }),

  // An account-level change (not tied to one portfolio). Returns the next account for the app to save.
  'mutate.account': (args) => {
    const params = typeof args.params === 'string' && args.params ? (JSON.parse(args.params) as Record<string, unknown>) : {};
    const op = text(args, 'op');
    if (op === 'tax') {
      const status = params.filerStatus;
      if (status !== 'filer' && status !== 'non-filer') throw new Error('Choose filer or non-filer.');
      return { account: JSON.stringify(setAccountFilerStatus(requireAccount(), status)) };
    }
    if (op === 'inbox') return { account: JSON.stringify(changeInbox(requireAccount(), params)) };
    // Every SIP Blueprint change (the plan itself, a month's ticks and stepper edits) goes through one op family.
    if (op.startsWith('sip.')) return { account: JSON.stringify(mutateBlueprint(requireAccount(), op.slice(4), params)) };
    const id = typeof params.id === 'string' ? params.id : '';
    const account = requireAccount();
    if (op === 'portfolio.add') {
      if (!id) throw new Error('A new portfolio needs an id.');
      const added = { id, name: portfolioName(String(params.name ?? '')), portfolio: { ...blankPortfolio(), taxProfile: accountTaxProfile(account) } };
      return { account: JSON.stringify(normalizeAccount({ ...account, portfolios: [...account.portfolios, added] }, false)) };
    }
    if (op === 'portfolio.rename') return { account: JSON.stringify(renamePortfolio(account, id, String(params.name ?? ''))) };
    if (op === 'portfolio.lock') return { account: JSON.stringify(setPortfolioLocked(account, id, params.locked === true)) };
    if (op === 'portfolio.remove') return { account: JSON.stringify(removePortfolio(account, id)) };
    throw new Error(`Unknown account change: ${op}`);
  },

  // The readable (NOT encrypted) export of the whole account. The app asks the person to confirm before sharing it.
  'backup.readable': () => {
    const result = accountBackupShare(requireAccount());
    return result.ok ? { ok: true, text: result.text, title: result.title } : { ok: false, reason: result.reason };
  },

  // A ledger change. Returns the next account as JSON for the app to save; the loaded account stays untouched.
  mutate: (args) => {
    const params = typeof args.params === 'string' && args.params ? (JSON.parse(args.params) as Record<string, unknown>) : {};
    const next = mutateAccount(requireAccount(), text(args, 'portfolio'), text(args, 'op'), params);
    return { account: JSON.stringify(next) };
  },

  // What the entry form offers: writable portfolios, companies to pick from, and today's date.
  'entry.options': (args) => {
    const account = requireAccount();
    const query = typeof args.query === 'string' ? args.query : '';
    return {
      today: today(),
      month: currentMonth(),
      sectors: SECTORS,
      portfolios: account.portfolios.map((p) => ({
        id: p.id,
        name: p.name,
        locked: Boolean(p.locked),
        companies: filterCompanies(p.portfolio.companies, query).map((c) => ({ ticker: c.ticker, name: c.name, sector: c.sector })),
      })),
    };
  },

  // Live totals under the form: "Total cost including fees" and so on.
  'entry.totals': (args) => {
    const n = (key: string) => (typeof args[key] === 'string' && args[key] !== '' ? Number(args[key]) : null);
    return tradeTotals(text(args, 'kind') as 'buy' | 'sell' | 'opening', n('shares'), n('price'), n('fees'));
  },
};

/** Runs one named call. Returns `{ ok: true, value }` or `{ ok: false, error }`; never throws. */
export function call(name: string, argsJson: string): string {
  try {
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown engine call: ${name}`);
    const args = argsJson ? (JSON.parse(argsJson) as Args) : {};
    return JSON.stringify({ ok: true, value: handler(args) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
