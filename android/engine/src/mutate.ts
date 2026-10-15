// Ledger edits for the Android app. Each op validates exactly as the Expo transaction screen does, applies the shared
// pure mutation, and returns the whole next account as JSON. Nothing is stored here: the app saves it (revisioned,
// encrypted) and only then loads it back, so a failed save never changes what the screens show.
import { replacePortfolio, portfolioAt, type PortfolioAccount } from '../../../lib/portfolio-account.ts';
import { validate } from '../../../lib/portfolio.ts';
import { parseReview, type ReviewRow } from '../../../mobile/src/data/record-buys.ts';
import { applyTargets } from '../../../lib/targets.ts';
import { setBudget } from '../../../mobile/src/data/sip.ts';
import { withPicksInputs } from '../../../mobile/src/data/picks.ts';
import { heldValues, recordRun, runLocalPicks } from '../../../lib/picks-local.ts';
import { parsePublicAnalysis } from '../../../lib/api-validate.ts';
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
  // One plan covers every portfolio, so a buy may name a company the receiving portfolio does not have yet: add it
  // with no target, like the Expo review sheet does.
  const params = op === 'buys' ? { ...p, buys: reviewedBuys(p) } : p;
  const withBuys = op === 'buys' ? withMissingCompanies(current, account, params.buys as BuyDraft[]) : current;
  // A company typed into the entry form is added in the same save as its first entry, so one Undo removes both.
  const base = isNewCompany(p.newCompany) ? addCompany(withBuys, { ticker: str(p.newCompany, 'ticker'), name: str(p.newCompany, 'name'), sector: str(p.newCompany, 'sector') }, p.newCompany.quote as Parameters<typeof addCompany>[2]) : withBuys;
  const next = apply(base, op, params);
  validate(next);
  return replacePortfolio(account, next, { id: portfolioId });
}

function isNewCompany(value: unknown): value is Params & { quote: unknown } {
  return typeof value === 'object' && value !== null && 'quote' in value;
}

/** Buys from the review sheet's typed rows (validated like the sheet does), or already-parsed drafts. */
function reviewedBuys(p: Params): BuyDraft[] {
  if (!Array.isArray(p.rows)) return (p.buys as BuyDraft[]) ?? [];
  const parsed = parseReview(p.rows as ReviewRow[], num(p, 'feePct') ?? 0);
  if (Object.keys(parsed.errors).length || !parsed.buys.length) {
    throw new Error(parsed.buys.length || Object.keys(parsed.errors).length ? 'Fix the highlighted rows first.' : 'Include at least one buy.');
  }
  return parsed.buys;
}

function withMissingCompanies(current: Parameters<typeof recordBuys>[0], account: PortfolioAccount, buys: BuyDraft[]) {
  const missing: typeof current.companies = [];
  for (const b of buys) {
    if (current.companies.some((c) => c.ticker === b.ticker) || missing.some((c) => c.ticker === b.ticker)) continue;
    const found = account.portfolios.flatMap((x) => x.portfolio.companies).find((c) => c.ticker === b.ticker);
    if (found) missing.push({ ...found, target: 0 });
  }
  return missing.length ? { ...current, companies: [...current.companies, ...missing] } : current;
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
    case 'targets': {
      const rows = (p.rows as { ticker: string; weight: string; approved: boolean; screenDate: string }[]) ?? [];
      for (const r of rows) {
        if (r.screenDate && !isIsoDate(r.screenDate)) throw new Error(`Enter ${r.ticker}'s screening date as YYYY-MM-DD, or leave it blank.`);
      }
      return applyTargets(portfolio, rows.map((r) => ({ ticker: r.ticker, target: parseNumber(r.weight) ?? 0, approved: r.approved, screenDate: r.screenDate })));
    }
    case 'budget': {
      const amount = num(p, 'amount');
      if (amount === null) throw new Error('Enter the monthly budget.');
      return setBudget(portfolio, str(p, 'month'), amount);
    }
    case 'picksInputs': {
      const amount = num(p, 'amount');
      if (amount === null) throw new Error('Enter the amount to invest.');
      const list = Array.isArray(p.shortlist) ? (p.shortlist as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      if (!list.length) throw new Error('Choose at least one company.');
      return withPicksInputs(portfolio, str(p, 'month'), list, amount) ?? portfolio;
    }
    case 'picksRun': {
      const amount = num(p, 'amount');
      if (amount === null || amount <= 0) throw new Error('Enter the amount to invest.');
      const analysis = parsePublicAnalysis(JSON.parse(str(p, 'analysis')));
      if (!analysis) throw new Error('The company data response was not understood.');
      const shortlist = Array.isArray(p.shortlist) ? (p.shortlist as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      const run = runLocalPicks({ analysis, month: str(p, 'month'), amount, feePct: num(p, 'feePct') ?? 0, shortlist, holdings: heldValues(portfolio) });
      return { ...portfolio, monthlyPicksRuns: recordRun(portfolio.monthlyPicksRuns, run) };
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
