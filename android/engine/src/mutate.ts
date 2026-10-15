// Ledger edits for the Android app. Each op validates exactly as the Expo transaction screen does, applies the shared
// pure mutation, and returns the whole next account as JSON. Nothing is stored here: the app saves it (revisioned,
// encrypted) and only then loads it back, so a failed save never changes what the screens show.
import { replacePortfolio, portfolioAt, type PortfolioAccount } from '../../../lib/portfolio-account.ts';
import { validate } from '../../../lib/portfolio.ts';
import {
  addCompany,
  isIsoDate,
  isValidSymbol,
  markDividendReceived,
  parseNumber,
  recordBuys,
  recordDividend,
  recordSplit,
  recordTrade,
  setManualQuote,
  voidEntry,
  type BuyDraft,
  type EntryKind,
} from '../../../mobile/src/data/mutations.ts';

type Params = Record<string, unknown>;

const str = (p: Params, key: string): string => (typeof p[key] === 'string' ? (p[key] as string) : '');
const num = (p: Params, key: string): number | null => {
  const v = p[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return typeof v === 'string' ? parseNumber(v) : null;
};

/** Applies [op] to one portfolio of [account] and returns the next account (not yet loaded or saved). */
export function mutateAccount(account: PortfolioAccount, portfolioId: string, op: string, p: Params): PortfolioAccount {
  const current = portfolioAt(account, { id: portfolioId });
  const next = apply(current, op, p);
  validate(next);
  return replacePortfolio(account, next, { id: portfolioId });
}

function apply(portfolio: Parameters<typeof recordTrade>[0], op: string, p: Params) {
  const ticker = str(p, 'ticker').trim().toUpperCase();
  const date = str(p, 'date');
  const note = str(p, 'note').trim();
  const editingId = str(p, 'editingId') || undefined;
  switch (op) {
    case 'trade': {
      const kind = str(p, 'kind') as 'buy' | 'sell' | 'opening';
      if (!ticker) throw new Error('Choose a company.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      const shares = num(p, 'shares');
      if (!shares || shares <= 0 || !Number.isInteger(shares)) throw new Error('Enter a whole number of shares.');
      const price = num(p, 'price');
      if (kind !== 'opening' && (price === null || price <= 0)) throw new Error('Enter the price per share.');
      const fees = num(p, 'fees') ?? 0;
      if (fees < 0) throw new Error('Fees cannot be negative.');
      const month = str(p, 'month');
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('SIP month must look like 2026-10.');
      return recordTrade(portfolio, { ticker, kind, date, shares, price, fees, month: kind === 'buy' ? month : '', note }, editingId);
    }
    case 'dividend': {
      if (!ticker) throw new Error('Choose a company.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      const perShare = num(p, 'perShare');
      if (perShare === null || perShare <= 0) throw new Error('Enter the dividend per share.');
      return recordDividend(portfolio, { ticker, date, perShare, note }, editingId);
    }
    case 'split': {
      if (!ticker) throw new Error('Choose a company.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      const oldShares = num(p, 'oldShares');
      const newShares = num(p, 'newShares');
      if (!oldShares || !newShares || oldShares <= 0 || newShares <= oldShares) throw new Error('Enter the old and new share counts (new must be larger).');
      return recordSplit(portfolio, { ticker, date, oldShares, newShares, note }, editingId);
    }
    case 'void':
      return voidEntry(portfolio, str(p, 'entryKind') as EntryKind, str(p, 'id'));
    case 'price': {
      const price = num(p, 'price');
      if (price === null) throw new Error('Enter a price above zero.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      return setManualQuote(portfolio, ticker, price, date);
    }
    case 'received': {
      const paymentDate = str(p, 'paymentDate');
      if (!isIsoDate(paymentDate)) throw new Error('Enter the date as YYYY-MM-DD.');
      return markDividendReceived(portfolio, str(p, 'id'), { paymentDate, grossAmount: num(p, 'grossAmount'), taxWithheld: num(p, 'taxWithheld') });
    }
    case 'buys':
      return recordBuys(portfolio, p.buys as BuyDraft[], str(p, 'month'), date || undefined, note);
    case 'company': {
      if (!isValidSymbol(ticker)) throw new Error('Enter a valid PSX symbol (2-12 letters or digits).');
      return addCompany(portfolio, { ticker, name: str(p, 'name'), sector: str(p, 'sector') }, p.quote as Parameters<typeof addCompany>[2]);
    }
    default:
      throw new Error(`Unknown ledger change: ${op}`);
  }
}
