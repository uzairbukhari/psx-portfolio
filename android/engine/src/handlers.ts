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
