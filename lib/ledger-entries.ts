// Pure ledger-entry builders (no React): the dashboard needs them at first paint, while the Activity view
// (app/ledger-timeline.tsx) is loaded on demand.
import { describePieces, metalPosition, type Asset } from './assets.ts';
import { fundPosition } from './funds.ts';
import {
  money,
  type Dividend,
  type Portfolio,
  type StockSplit,
  type TaxedDividend,
  type Trade,
} from './portfolio.ts';

export type EntryType =
  | 'buy'
  | 'sell'
  | 'opening'
  | 'adjustment'
  | 'dividend'
  | 'split';
export type Filter = 'all' | 'buy' | 'sell' | 'dividend' | 'split' | 'asset';

export type LedgerEntry = {
  key: string;
  date: string;
  ticker: string;
  type: EntryType;
  label: string;
  detail: string;
  /** SIP plan month (YYYY-MM) for monthly-plan buys, shown as a chip. */
  sipMonth?: string;
  fees: number | null;
  amount: number | null;
  /** true when the amount is money received rather than paid */
  inflow: boolean;
  voided: boolean;
  /** An announced dividend that is not yet confirmed as received. */
  expected?: boolean;
  /** Set on gold, savings plan and fund entries: the kind of asset, shown as a chip beside its name. */
  assetKind?: 'Gold' | 'Silver' | 'Plan' | 'Fund';
  /** Gain on this sale worked out with the asset's own rules; undefined means "look it up in the stock ledger". */
  realizedGain?: number | null;
  /** True for money taken out of a savings plan: it is cash back, not a sale with a profit. */
  noGain?: boolean;
  correct: () => void;
  /** Set on gold, plan and fund pages: adds a Void / Restore button beside the edit button. */
  toggleVoid?: () => void;
  /** Present on expected dividends: opens the confirm-receipt form. */
  confirm?: () => void;
};

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['buy', 'Buys'],
  ['sell', 'Sells'],
  ['dividend', 'Dividends'],
  ['split', 'Splits'],
  ['asset', 'Other assets'],
];

export const cents = (n: number) => Math.round(n * 100) / 100;

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const sipChip = (month: string) =>
  `SIP ${MONTHS[Number(month.slice(5, 7)) - 1] ?? month}`;

export const monthLabel = (date: string) =>
  new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function buildEntries({
  trades,
  dividends,
  splits,
  taxed,
  onCorrectTrade,
  onCorrectDividend,
  onCorrectSplit,
  onConfirmDividend,
}: {
  trades: Trade[];
  dividends: Dividend[];
  splits: StockSplit[];
  taxed: TaxedDividend[];
  onCorrectTrade: (t: Trade) => void;
  onCorrectDividend: (d: Dividend) => void;
  onCorrectSplit: (s: StockSplit) => void;
  onConfirmDividend?: (d: Dividend) => void;
}): LedgerEntry[] {
  const byId = new Map(taxed.map((t) => [t.id, t]));
  const out: LedgerEntry[] = [];
  for (const t of trades) {
    const cash =
      t.price === null
        ? null
        : t.shares * t.price + (t.kind === 'sell' ? -t.fees : t.fees);
    out.push({
      key: 't' + t.id,
      date: t.date,
      ticker: t.ticker,
      type: t.kind,
      label:
        t.kind === 'opening'
          ? 'Opening'
          : t.kind === 'adjustment'
            ? 'Holding adjustment'
            : t.kind === 'sell'
              ? 'Sale'
              : 'Purchase',
      detail:
        `${t.shares.toLocaleString()} sh` +
        (t.price === null ? '' : ` @ ${money(t.price)}`),
      sipMonth: t.month || undefined,
      fees: t.fees,
      amount: cash,
      inflow: t.kind === 'sell',
      voided: !!t.voided,
      correct: () => onCorrectTrade(t),
    });
  }
  for (const d of dividends) {
    const tax = byId.get(d.id);
    const net = tax?.netAmount ?? tax?.grossAmount ?? null;
    const expected = tax?.status === 'expected';
    out.push({
      key: 'd' + d.id,
      date: d.date,
      ticker: d.ticker,
      type: 'dividend',
      label: expected ? 'Expected dividend' : 'Dividend',
      detail:
        (d.perShare === undefined ? '' : `${money(d.perShare)}/sh · `) +
        (d.source === 'import'
          ? 'CDC import'
          : d.source === 'auto'
            ? 'PSX auto'
            : 'Manual') +
        (tax?.netAmount == null
          ? ' · gross'
          : tax.taxBasis === 'actual'
            ? ' · net of recorded tax'
            : ' · net of estimated tax') +
        (expected
          ? ` · not yet received${tax?.entitlementCertain === false ? ' · entitlement date unconfirmed' : ''}`
          : d.paymentDate
            ? ` · paid ${d.paymentDate}${d.paymentDateEstimated ? ' (estimated)' : ''}`
            : ''),
      fees: null,
      amount: net,
      inflow: !expected,
      voided: !!d.voided,
      expected,
      correct: () => onCorrectDividend(d),
      confirm:
        expected && onConfirmDividend ? () => onConfirmDividend(d) : undefined,
    });
  }
  for (const s of splits) {
    out.push({
      key: 's' + s.id,
      date: s.date,
      ticker: s.ticker,
      type: 'split',
      label: 'Split',
      detail:
        `${s.newShares}-for-${s.oldShares}` + (s.note ? ` · ${s.note}` : ''),
      fees: null,
      amount: null,
      inflow: false,
      voided: !!s.voided,
      correct: () => onCorrectSplit(s),
    });
  }
  return out.sort(
    (a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key),
  );
}

/**
 * Gold, savings plan and mutual fund purchases, sales, redemptions and dividends, in the same shape as the stock
 * entries so Activity shows everything in one list. Statement values are not transactions and are left out.
 */
export function buildAssetEntries(
  assets: { asset: Asset; portfolioName?: string }[],
  onOpenAssets: () => void,
  /** On an asset's own page: edit and void entries in place instead of sending you to Holdings, and list plan statement values. */
  page?: {
    correct: (asset: Asset, entryId: string) => void;
    toggleVoid: (asset: Asset, entryId: string) => void;
  },
): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const { asset, portfolioName } of assets) {
    const where = portfolioName ? ` · ${portfolioName}` : '';
    const key = (id: string) => `a${portfolioName ?? ''}${asset.id}${id}`;
    try {
      if (asset.kind === 'metal') {
        const gains = new Map(
          metalPosition(asset).history.map((h) => [h.id, h.realizedGain]),
        );
        for (const e of asset.entries) {
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type: e.type,
            label:
              e.type === 'opening'
                ? 'Opening'
                : e.type === 'sell'
                  ? 'Sale'
                  : 'Purchase',
            detail: `${describePieces(e)}${e.form ? ` · ${e.form}` : ''}${where}`,
            fees: null,
            amount: e.amount,
            inflow: e.type === 'sell',
            voided: !!e.voided,
            assetKind: asset.metal === 'gold' ? 'Gold' : 'Silver',
            realizedGain:
              e.type === 'sell' ? (gains.get(e.id) ?? null) : undefined,
            correct: () =>
              page ? page.correct(asset, e.id) : onOpenAssets(),
            toggleVoid: page ? () => page.toggleVoid(asset, e.id) : undefined,
          });
        }
      } else if (asset.kind === 'plan') {
        for (const e of asset.entries) {
          const paidIn = e.type === 'contribution';
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type: paidIn ? 'buy' : 'sell',
            label: paidIn ? 'Paid in' : 'Redeemed',
            detail: `${paidIn ? 'Contribution to the plan' : 'Cash taken out of the plan'}${where}`,
            fees: null,
            amount: e.amount,
            inflow: !paidIn,
            voided: !!e.voided,
            assetKind: 'Plan',
            noGain: !paidIn,
            correct: () =>
              page ? page.correct(asset, e.id) : onOpenAssets(),
            toggleVoid: page ? () => page.toggleVoid(asset, e.id) : undefined,
          });
        }
        if (page)
          for (const x of asset.valuations) {
            out.push({
              key: key(x.id),
              date: x.date,
              ticker: asset.name,
              type: 'opening',
              label: 'Statement',
              detail: `Value from your statement${x.note ? ` · ${x.note}` : ''}${where}`,
              fees: null,
              amount: x.value,
              inflow: false,
              voided: !!x.voided,
              assetKind: 'Plan',
              noGain: true,
              correct: () => page.correct(asset, x.id),
              toggleVoid: () => page.toggleVoid(asset, x.id),
            });
          }
      } else {
        const gains = new Map(
          fundPosition(asset).history.map((h) => [h.id, h.realizedGain]),
        );
        for (const e of asset.entries) {
          const units =
            e.units === undefined
              ? ''
              : `${Math.round(e.units * 10000) / 10000} units`;
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type:
              e.type === 'redeem'
                ? 'sell'
                : e.type === 'dividend' || e.type === 'reinvest'
                  ? 'dividend'
                  : e.type === 'opening'
                    ? 'opening'
                    : 'buy',
            label:
              e.type === 'opening'
                ? 'Opening'
                : e.type === 'redeem'
                  ? 'Redemption'
                  : e.type === 'dividend'
                    ? 'Dividend'
                    : e.type === 'reinvest'
                      ? 'Reinvested'
                      : 'Purchase',
            detail: `${units || 'Cash payout'}${e.type === 'reinvest' ? ' · dividend reinvested' : ''}${e.estimated ? ' · estimated' : ''}${where}`,
            fees: null,
            amount: e.amount,
            inflow: e.type === 'redeem' || e.type === 'dividend',
            voided: !!e.voided,
            assetKind: 'Fund',
            realizedGain:
              e.type === 'redeem' ? (gains.get(e.id) ?? null) : undefined,
            correct: () =>
              page ? page.correct(asset, e.id) : onOpenAssets(),
            toggleVoid: page ? () => page.toggleVoid(asset, e.id) : undefined,
          });
        }
      }
    } catch {
      // An asset with an invalid history is reported on its own card; skip it here rather than break Activity.
    }
  }
  return out;
}

/** Gold, plan and fund pages show only that asset's records, so there are no stock companies or sales to look up. */
export const NO_STOCKS = {
  companies: [],
  trades: [],
  quotes: {},
  budgets: {},
} as Portfolio;

