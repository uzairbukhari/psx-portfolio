// "Match my statement": your bank or AMC app shows units (or a value) for a fund on a date, and the ledger disagrees. The gap is
// usually dividends reinvested as units (or tax and zakat differing from the estimate). If estimated payout entries explain
// it, they are scaled to fit and confirmed, and the fund's tax rate is learned from them; otherwise the difference is
// recorded as one adjustment entry. Pure, like lib/funds.ts.
import {
  fundPosition,
  valueFund,
  type FundAsset,
  type FundEntry,
} from './funds.ts';
import type { FundNavRow } from './mufap.ts';
import { DEFAULT_PAYOUT_TAX } from './fund-payouts.ts';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const units4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export type StatementInput = {
  date: string;
  /** Units the statement shows (best: exact). */
  units?: number;
  /** Value the statement shows; divided by the price on that date, so only as exact as the price. */
  value?: number;
};
export type StatementMatch =
  | { ok: true; fund: FundAsset; changed: boolean; message: string }
  | { ok: false; error: string };

export function matchStatement(
  fund: FundAsset,
  navs: FundNavRow[],
  input: StatementInput,
  today: string,
  batch: string,
): StatementMatch {
  if (input.date > today)
    return { ok: false, error: 'Use a date that is not in the future.' };
  const upTo = {
    ...fund,
    entries: fund.entries.filter((e) => e.date <= input.date),
  };
  let held: number;
  try {
    held = fundPosition(upTo).units;
  } catch {
    return {
      ok: false,
      error:
        'The ledger has a redemption larger than the units held. Fix that first.',
    };
  }
  let price: number | null = null;
  let target: number;
  let tolerance = 0.00005;
  if (input.units !== undefined) {
    if (!(input.units >= 0))
      return { ok: false, error: 'Enter the units shown on your statement.' };
    target = input.units;
  } else {
    if (!(input.value !== undefined && input.value > 0))
      return {
        ok: false,
        error: 'Enter the units or the value shown on your statement.',
      };
    price =
      valueFund({ ...upTo, entries: upTo.entries }, navs, input.date).price
        ?.nav ?? null;
    if (price === null)
      return {
        ok: false,
        error:
          'No price is known for that date, so a value cannot be turned into units. Enter the units instead.',
      };
    target = input.value / price;
    tolerance = 0.5 / price; // a statement value is rounded to the rupee
  }
  const gap = target - held;
  if (Math.abs(gap) <= tolerance)
    return {
      ok: true,
      fund,
      changed: false,
      message: 'Your ledger already matches that statement.',
    };
  if (gap < 0)
    return {
      ok: false,
      error: `Your statement shows ${units4(-gap)} fewer units than the ledger (${units4(held)}). Check for a missing redemption or a purchase recorded twice.`,
    };

  const estimated = fund.entries.filter(
    (e) =>
      e.source === 'auto' &&
      e.estimated &&
      !e.voided &&
      e.type === 'reinvest' &&
      e.date <= input.date,
  );
  const explained = estimated.reduce((a, e) => a + (e.units ?? 0), 0);
  if (explained > 0) {
    const factor = (explained + gap) / explained;
    const ids = new Set(estimated.map((e) => e.id));
    const entries = fund.entries.map(
      (e): FundEntry =>
        ids.has(e.id)
          ? {
              ...e,
              units: units4((e.units ?? 0) * factor),
              amount: cents((e.amount ?? 0) * factor),
              estimated: false,
              autoBatch: batch,
              note: `Matched to your statement of ${input.date} (${units4(target)} units). ${e.note}`.slice(
                0,
                500,
              ),
            }
          : e,
    );
    const rate = fund.payoutTaxRate ?? DEFAULT_PAYOUT_TAX;
    const learned = 1 - (1 - rate) * factor;
    const next: FundAsset = { ...fund, entries };
    if (learned >= 0 && learned < 1)
      next.payoutTaxRate = Math.round(learned * 1e4) / 1e4;
    return {
      ok: true,
      fund: next,
      changed: true,
      message: `Adjusted ${estimated.length} estimated payout${estimated.length === 1 ? '' : 's'} by ${units4(gap)} units to match your statement.${next.payoutTaxRate !== undefined && next.payoutTaxRate !== fund.payoutTaxRate ? ` Future payouts use an effective tax rate of ${(next.payoutTaxRate * 100).toFixed(1)}%.` : ''}`,
    };
  }
  const nav = price ?? valueFund(upTo, navs, input.date).price?.nav ?? null;
  const entry: FundEntry = {
    id: `fmatch-${fund.mufapId}-${input.date}-${batch.slice(-6)}`,
    type: 'reinvest',
    date: input.date,
    units: units4(gap),
    amount: nav === null ? 0 : cents(gap * nav),
    note: `Statement adjustment: your statement of ${input.date} shows ${units4(target)} units, ${units4(gap)} more than the ledger (usually dividends reinvested by the fund).`,
    source: 'auto',
    autoBatch: batch,
  };
  return {
    ok: true,
    fund: { ...fund, entries: [...fund.entries, entry] },
    changed: true,
    message: `Added a statement adjustment of ${units4(gap)} units.`,
  };
}
