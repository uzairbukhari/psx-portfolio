// Turns MUFAP's public payout table into estimated entries on a held fund. A fund that reinvests (the default) issues
// extra units at the price after the payout; one that pays cash gives a cash dividend instead. Pure and deterministic,
// and shared with the phone. Everything made here is an estimate: the payout per unit and price are exact, but the tax
// withheld is a rate (and the units of a statement are rounded), so a statement you enter later always wins.
import { fundPosition, type FundAsset, type FundEntry } from './funds.ts';
import type { Asset } from './assets.ts';
import type { FundPayoutRow } from './mufap.ts';

/** Filer rate on dividends from money market and income funds; the fund's own rate replaces it. */
export const DEFAULT_PAYOUT_TAX = 0.15;
/** A payout within this many days of an entry you made yourself counts as already recorded. */
const MANUAL_WINDOW_DAYS = 5;

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const units4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
export const payoutEntryId = (mufapId: string, payoutDate: string) =>
  `fpayout-${mufapId}-${payoutDate}`;

export type FundPayoutPlan = {
  entries: FundEntry[];
  added: number;
  updated: number;
};

/** Units held at the close of the day before `date` (the holders a payout goes to). */
function unitsBefore(fund: FundAsset, entries: FundEntry[], date: string) {
  try {
    return fundPosition({
      ...fund,
      entries: entries.filter((e) => e.date < date),
    }).units;
  } catch {
    return 0;
  }
}

/**
 * Returns the fund's entries with payout entries added (or refreshed while still estimated), or null when nothing
 * changes. Payouts before your first unit, on days you held none, or already recorded by hand are skipped; a voided
 * automatic entry is never added again.
 */
export function planFundPayouts(
  fund: FundAsset,
  payouts: FundPayoutRow[],
  today: string,
  batch: string,
): FundPayoutPlan | null {
  if (fund.closed) return null;
  const mine = payouts
    .filter((p) => p.mufapId === fund.mufapId && p.payoutDate <= today)
    .sort((a, b) => (a.payoutDate < b.payoutDate ? -1 : 1));
  if (!mine.length) return null;
  const rate = fund.payoutTaxRate ?? DEFAULT_PAYOUT_TAX;
  const asCash = fund.payoutMode === 'cash';
  const entries = fund.entries.map((e) => ({ ...e }));
  let added = 0;
  let updated = 0;
  for (const p of mine) {
    const id = payoutEntryId(p.mufapId, p.payoutDate);
    const held = unitsBefore(fund, entries, p.payoutDate);
    const gross = held * p.perUnit;
    const net = cents(gross * (1 - rate));
    const existing = entries.find((e) => e.id === id);
    if (existing) {
      if (existing.voided || !existing.estimated) continue;
      const newUnits = asCash ? undefined : units4(net / p.exNav);
      if (
        existing.amount === net &&
        (asCash || existing.units === newUnits) &&
        existing.type === (asCash ? 'dividend' : 'reinvest')
      )
        continue;
      if (!(held > 0 && net > 0)) {
        existing.voided = true;
        updated += 1;
        continue;
      }
      existing.type = asCash ? 'dividend' : 'reinvest';
      existing.amount = net;
      if (asCash) delete existing.units;
      else existing.units = newUnits;
      existing.autoBatch = batch;
      updated += 1;
      continue;
    }
    if (!(held > 1e-9) || !(net > 0)) continue;
    const handled = entries.some(
      (e) =>
        !e.voided &&
        e.source !== 'auto' &&
        (e.type === 'reinvest' || e.type === 'dividend') &&
        Math.abs(day(e.date) - day(p.payoutDate)) <= MANUAL_WINDOW_DAYS,
    );
    if (handled) continue;
    const newUnits = units4(net / p.exNav);
    if (!asCash && !(newUnits > 0)) continue;
    entries.push({
      id,
      type: asCash ? 'dividend' : 'reinvest',
      date: p.payoutDate,
      ...(asCash ? {} : { units: newUnits }),
      amount: net,
      note: `Estimated from MUFAP's payout of Rs ${p.perUnit} per unit on ${units4(held)} units, after ${Math.round(rate * 100)}% tax${asCash ? '' : `, reinvested at Rs ${p.exNav}`}. Enter your statement to correct it.`,
      source: 'auto',
      estimated: true,
      autoBatch: batch,
      perUnit: p.perUnit,
      exNav: p.exNav,
    });
    added += 1;
  }
  return added || updated ? { entries, added, updated } : null;
}

/** Mutates the assets: voids every payout entry the run `batch` added or changed. Returns how many. */
export function undoFundPayoutBatch(assets: Asset[], batch: string): number {
  let n = 0;
  for (const a of assets)
    if (a.kind === 'fund')
      for (const e of a.entries)
        if (e.autoBatch === batch && e.source === 'auto' && !e.voided) {
          e.voided = true;
          n += 1;
        }
  return n;
}
