// Reads the decrypted ledger for the SIP Blueprint: current class weights, money in per month and class, and the
// one-click "log it" entries. Pure: no React, no I/O, no clock. Kept apart from `sip-blueprint.ts` so the ledger
// validator can import that file without a cycle.
import { accountOverview } from './account-overview.ts';
import { newAssetId, valueAsset, type Asset, type MetalAsset, type MetalEntry } from './assets.ts';
import type { CurrencyAsset, CurrencyEntry } from './currency.ts';
import type { CurrencyCode, FxRateRow } from './fx-rates.ts';
import type { MetalRateRow } from './metal-rates.ts';
import type { FundNavRow } from './mufap.ts';
import { moneyInFlows } from './performance.ts';
import type { PlanNavRow } from './plans.ts';
import { CURRENCY_NAMES } from './fx-rates.ts';
import type { DisplayPart, Portfolio } from './portfolio.ts';
import { SIP_CLASSES, type SipClass, type SipMonth } from './sip-blueprint.ts';

export type SipRates = {
  metalRates?: MetalRateRow[];
  fundNavs?: FundNavRow[];
  planNavs?: PlanNavRow[];
  fxRates?: FxRateRow[];
};

const sipClassOf = (key: string): SipClass | null =>
  key === 'plans' ? 'funds' : (SIP_CLASSES as string[]).includes(key) ? (key as SipClass) : null;

/** What is held now, per blueprint class (savings plans count with funds). `weights` is null when nothing is held. */
export function classWeights(
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  rates: SipRates = {},
): { weights: Record<SipClass, number> | null; values: Record<SipClass, number>; total: number } {
  const overview = accountOverview(parts, asOf, rates);
  const values = Object.fromEntries(SIP_CLASSES.map((k) => [k, 0])) as Record<SipClass, number>;
  for (const c of overview.classes) {
    const k = sipClassOf(c.key);
    if (k) values[k] += c.value;
  }
  const total = SIP_CLASSES.reduce((n, k) => n + values[k], 0);
  const weights = total > 0 ? (Object.fromEntries(SIP_CLASSES.map((k) => [k, (values[k] / total) * 100])) as Record<SipClass, number>) : null;
  return { weights, values, total };
}

/** Money that went in per month, per class (purchases only, sales and redemptions are not subtracted). */
export function moneyInByMonth(
  parts: DisplayPart[],
  asOf: string,
  rates: SipRates = {},
): Record<string, Partial<Record<SipClass, number>>> {
  const out: Record<string, Partial<Record<SipClass, number>>> = {};
  const add = (date: string, k: SipClass, amount: number) => {
    if (date > asOf || !(amount > 0)) return;
    const row = (out[date.slice(0, 7)] ??= {});
    row[k] = (row[k] ?? 0) + amount;
  };
  for (const part of parts) {
    for (const f of moneyInFlows(part.portfolio).flows) add(f.date, 'stocks', f.amount);
    for (const asset of part.portfolio.assets ?? []) {
      const v = valueAsset(asset, rates.metalRates ?? [], asOf, rates.fundNavs ?? [], rates.planNavs ?? [], rates.fxRates ?? []);
      const k = sipClassOf(v.classKey);
      if (!k) continue;
      for (const f of v.flows) add(f.date, k, f.amount);
    }
  }
  return out;
}

/**
 * Shares held at the start of the month: today's value minus what went in this month, per class. Using this for the
 * drift plan keeps the plan steady while the month's purchases are being logged. Null when nothing was held.
 */
export function startOfMonthWeights(
  values: Record<SipClass, number>,
  thisMonthIn: Partial<Record<SipClass, number>> = {},
): Record<SipClass, number> | null {
  const before = Object.fromEntries(
    SIP_CLASSES.map((k) => [k, Math.max(0, (values[k] ?? 0) - (thisMonthIn[k] ?? 0))]),
  ) as Record<SipClass, number>;
  const total = SIP_CLASSES.reduce((n, k) => n + before[k], 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(SIP_CLASSES.map((k) => [k, (before[k] / total) * 100])) as Record<SipClass, number>;
}

/** What went in per month and class: the ledger, or the amount ticked by hand when that is larger (never added twice). */
export function mergeActual(
  ledger: Record<string, Partial<Record<SipClass, number>>>,
  months: Record<string, SipMonth>,
): Record<string, Partial<Record<SipClass, number>>> {
  const out: Record<string, Partial<Record<SipClass, number>>> = {};
  for (const [m, row] of Object.entries(ledger)) out[m] = { ...row };
  for (const [m, snap] of Object.entries(months)) {
    const row = (out[m] ??= {});
    for (const k of SIP_CLASSES) {
      const manual = snap.done[k]?.amount;
      if (manual !== undefined) row[k] = Math.max(row[k] ?? 0, manual);
    }
  }
  return out;
}

/** Total money in per month (for the history chart and the streak). */
export function totalsByMonth(byClass: Record<string, Partial<Record<SipClass, number>>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(byClass).map(([m, row]) => [m, SIP_CLASSES.reduce((n, k) => n + (row[k] ?? 0), 0)]),
  );
}

export type QuickEntry =
  | { class: 'gold'; date: string; grams: number; amount: number }
  | { class: 'currency'; date: string; currency: CurrencyCode; units: number; pkr: number };

const LOG_NOTE = 'Logged from SIP Blueprint';

/** Returns the portfolio with a purchase added: into the matching holding when there is one, else into a new holding. */
export function withQuickEntry(portfolio: Portfolio, e: QuickEntry): Portfolio {
  const assets: Asset[] = [...(portfolio.assets ?? [])];
  if (e.class === 'currency') {
    const entry: CurrencyEntry = { id: newAssetId(), date: e.date, type: 'buy', units: e.units, pkr: e.pkr, note: LOG_NOTE };
    const at = assets.findIndex((a) => a.kind === 'currency' && a.currency === e.currency);
    if (at >= 0) {
      const a = assets[at] as CurrencyAsset;
      assets[at] = { ...a, entries: [...a.entries, entry] };
    } else
      assets.push({
        id: newAssetId(),
        kind: 'currency',
        name: `${CURRENCY_NAMES[e.currency]} (cash)`,
        currency: e.currency,
        heldAt: 'cash',
        note: '',
        entries: [entry],
      });
    return { ...portfolio, assets };
  }
  const entry: MetalEntry = { id: newAssetId(), date: e.date, type: 'buy', grams: e.grams, amount: e.amount, note: LOG_NOTE };
  const at = assets.findIndex((a) => a.kind === 'metal' && a.metal === 'gold' && a.karat === 24);
  if (at >= 0) {
    const a = assets[at] as MetalAsset;
    assets[at] = { ...a, entries: [...a.entries, entry] };
  } else
    assets.push({
      id: newAssetId(),
      kind: 'metal',
      name: 'Gold 24K',
      metal: 'gold',
      karat: 24,
      note: '',
      entries: [entry],
    });
  return { ...portfolio, assets };
}
