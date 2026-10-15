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
  type PortfolioAccount,
} from '../../../lib/portfolio-account.ts';
import { openPositions, safeHoldings, soldOutPositions, totals, type Holding } from '../../../mobile/src/data/derive.ts';
import { filterBySector, holdingFlags, sectorsOf, sortHoldings, weightOf, type HoldingSort } from '../../../mobile/src/data/holdings-view.ts';
import { today } from '../../../lib/portfolio.ts';
import { activityEntries, companyDividends, readOnlyReason } from '../../../mobile/src/data/derive.ts';
import { parseEod, parseIntraday, rangeChange, sliceRange, type HistoryRange } from '../../../lib/price-history.ts';
import { filterActivity, groupByMonth, type ActivityFilter } from '../../../mobile/src/data/activity-view.ts';
import { mutateAccount } from './mutate.ts';
import { tradeTotals, filterCompanies } from '../../../mobile/src/data/entry-form.ts';
import { buildPlan, currentMonth, monthBuys, unifiedPlanSource } from '../../../mobile/src/data/sip.ts';
import { parseReview, type ReviewRow } from '../../../mobile/src/data/record-buys.ts';
import { parseNumber } from '../../../mobile/src/data/mutations.ts';
import { evenWeights, screenStatus, targetRows, targetTotals } from '../../../lib/targets.ts';
import { searchCompanies } from '../../../mobile/src/data/picks.ts';
import { WEIGHT_CAP } from '../../../lib/portfolio.ts';
import { monthProgress, nextActions, returnBreakdown } from '../../../mobile/src/data/today.ts';

export const ENGINE_API_VERSION = 1;

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

let loaded: PortfolioAccount | null = null;

function requireAccount(): PortfolioAccount {
  if (!loaded) throw new Error('No portfolio is loaded.');
  return loaded;
}

const text = (args: Args, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Missing ${key}.`);
  return value;
};

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
    return true;
  },

  // The Holdings screen: sorted, filtered rows plus the headline numbers, for one portfolio or all of them.
  'holdings.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const sort = (typeof args.sort === 'string' ? args.sort : 'value') as HoldingSort;
    const sector = typeof args.sector === 'string' && args.sector ? args.sector : null;
    const portfolio = dashboardPortfolio(requireAccount(), scope);
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

  // The Today screen: headline figures, return breakdown, this month's progress and the next actions.
  'today.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const month = typeof args.month === 'string' && args.month ? args.month : currentMonth();
    const now = today();
    const account = requireAccount();
    const portfolio = dashboardPortfolio(account, scope);
    const { held, error } = safeHoldings(portfolio);
    const summary = totals(held);
    const open = openPositions(held);
    return {
      now,
      month,
      summary,
      openCount: open.length,
      error,
      firstUse: portfolio.companies.length === 0 && portfolio.trades.length === 0 && !(portfolio.dividends ?? []).length,
      breakdown: returnBreakdown(portfolio, summary.gain),
      progress: monthProgress(portfolio, month),
      actions: nextActions(portfolio, held, month, now),
    };
  },

  // The Activity ledger: filtered, searched and grouped by month, newest first.
  'activity.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const filter = (typeof args.filter === 'string' ? args.filter : 'all') as ActivityFilter;
    const query = typeof args.query === 'string' ? args.query : '';
    const entries = filterActivity(activityEntries(dashboardPortfolio(requireAccount(), scope)), filter, query);
    return { count: entries.length, sections: groupByMonth(entries) };
  },

  // One company: position, expected and received dividends, and its ledger lines.
  'company.view': (args) => {
    const scope = typeof args.scope === 'string' ? args.scope : ALL_PORTFOLIOS;
    const ticker = text(args, 'ticker').toUpperCase();
    const portfolio = dashboardPortfolio(requireAccount(), scope);
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
      portfolios: requireAccount()
        .portfolios.filter((x) => x.portfolio.companies.some((c) => c.ticker === ticker))
        .map((x) => ({ id: x.id, name: x.name, locked: Boolean(x.locked) })),
      dividends: companyDividends(portfolio, ticker),
      entries: activityEntries(portfolio, ticker),
    };
  },

  // A price-history response cut to one chart range, with its change over the range.
  'history.series': (args) => {
    const data = JSON.parse(text(args, 'json')) as { eod?: number[][]; intraday?: number[][] };
    const points = sliceRange(parseEod(data.eod ?? []), parseIntraday(data.intraday ?? []), text(args, 'range') as HistoryRange);
    return { points, change: rangeChange(points) };
  },

  // The Plan tab (targets mode): one plan for the whole account, the month's buys and the review rows.
  'plan.view': (args) => {
    const account = requireAccount();
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
