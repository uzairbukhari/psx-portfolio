// Ledger edits for the Android app. Each op validates exactly as the Expo transaction screen does, applies the shared
// pure mutation, and returns the whole next account as JSON. Nothing is stored here: the app saves it (revisioned,
// encrypted) and only then loads it back, so a failed save never changes what the screens show.
import { replacePortfolio, portfolioAt, type PortfolioAccount } from '../../../lib/portfolio-account.ts';
import { renameTicker, validate } from '../../../lib/portfolio.ts';
import { parseReview, type ReviewRow } from '../../../mobile/src/data/record-buys.ts';
import { applyTargets } from '../../../lib/targets.ts';
import { setBudget } from '../../../mobile/src/data/sip.ts';
import { withPicksInputs } from '../../../mobile/src/data/picks.ts';
import { heldValues, recordRun, runLocalPicks } from '../../../lib/picks-local.ts';
import { parsePublicAnalysis } from '../../../lib/api-validate.ts';
import { accountSipBlueprint, setAccountSipBlueprint, accountZakat, setAccountZakat } from '../../../lib/portfolio-account.ts';
import { MANUAL_KINDS, PAYMENT_KINDS, applySchool, closeYear, newBook, recordTrail, validateZakat, zakatBreakdown, type ZakatBook, type ZakatInputs, type ZakatManualKind, type ZakatPaymentKind, type ZakatSchool } from '../../../lib/zakat.ts';
import { SIP_CLASSES, rebalanceEdit, validateBlueprint, type SipBlueprint, type SipClass, type SipMonth } from '../../../lib/sip-blueprint.ts';
import { withQuickEntry, type QuickEntry } from '../../../lib/sip-blueprint-data.ts';
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
    case 'sip.log': {
      // A gold or currency purchase logged from the SIP Blueprint: the same entry the asset form would add.
      const entry = quickEntry(p, date);
      return withQuickEntry(portfolio, entry);
    }
    case 'company': {
      if (!isValidSymbol(ticker)) throw new Error('Enter a valid PSX symbol (2-12 letters or digits).');
      return addCompany(portfolio, { ticker, name: str(p, 'name'), sector: str(p, 'sector') }, p.quote as Parameters<typeof addCompany>[2]);
    }
    case 'company.edit': {
      // The name and sector of a company already held. The symbol is changed by 'company.symbol' instead, because
      // that has to move every entry with it.
      const company = portfolio.companies.find((c) => c.ticker === ticker);
      if (!company) throw new Error(`${ticker} is not in this portfolio.`);
      const name = str(p, 'name').trim();
      if (!name) throw new Error('Enter the company name.');
      const sector = str(p, 'sector').trim();
      return {
        ...portfolio,
        companies: portfolio.companies.map((c) => (c.ticker === ticker ? { ...c, name, sector: sector || c.sector } : c)),
      };
    }
    case 'company.symbol':
      // PSX renamed the company: every trade, dividend, split and notice moves to the new symbol in one save.
      return renameTicker(portfolio, ticker, str(p, 'to').trim().toUpperCase());
    default:
      throw new Error(`Unknown ledger change: ${op}`);
  }
}

/** The purchase a "Log it" row saves: grams of 24K gold, or units of a currency, with the rupees paid. */
function quickEntry(p: Params, date: string): QuickEntry {
  if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
  const amount = num(p, 'amount');
  if (amount === null || amount <= 0) throw new Error('Enter the amount in rupees.');
  const kind = str(p, 'class');
  if (kind === 'gold') {
    const grams = num(p, 'grams');
    if (grams === null || grams <= 0) throw new Error('Enter the weight in grams.');
    return { class: 'gold', date, grams, amount };
  }
  if (kind === 'currency') {
    const units = num(p, 'units');
    if (units === null || units <= 0) throw new Error('Enter how much currency you bought.');
    const currency = str(p, 'currency').toUpperCase();
    if (currency !== 'USD' && currency !== 'AED' && currency !== 'SAR') throw new Error('Choose US dollars, dirhams or riyals.');
    return { class: 'currency', date, currency, units, pkr: amount };
  }
  throw new Error('Only gold and foreign currency can be logged here.');
}

/** A class key from the app, checked against the four the blueprint knows. */
function sipClass(p: Params, key = 'class'): SipClass {
  const value = str(p, key);
  if (!(SIP_CLASSES as string[]).includes(value)) throw new Error(`Unknown SIP class: ${value || '(none)'}.`);
  return value as SipClass;
}

/**
 * One change to the SIP Blueprint (account-level, stored in the first portfolio like the tax status). Returns the next
 * account; the app saves it with a revision check, as with every other change.
 */
export function mutateBlueprint(account: PortfolioAccount, op: string, p: Params): PortfolioAccount {
  const current = accountSipBlueprint(account);
  const next = nextBlueprint(current, op, p);
  if (next !== null) validateBlueprint(next);
  return setAccountSipBlueprint(account, next);
}

function requireBlueprint(current: SipBlueprint | null): SipBlueprint {
  if (!current) throw new Error('Set up your SIP first.');
  return current;
}

/** This month's record, started from the plan in force the first time anything is saved for the month. */
function monthRecord(b: SipBlueprint, month: string, p: Params): SipMonth {
  const existing = b.months[month];
  if (existing) return existing;
  const plan = JSON.parse(str(p, 'plan') || '{}') as Record<string, unknown>;
  const budget = num(p, 'budget') ?? b.budget;
  const row = {} as Record<SipClass, number>;
  for (const k of SIP_CLASSES) {
    const value = plan[k];
    row[k] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return { budget, plan: row, done: {} };
}

function withMonth(b: SipBlueprint, month: string, patch: Partial<SipMonth>, base: SipMonth): SipBlueprint {
  const next: SipMonth = { ...base, ...patch };
  if (patch.edited === undefined && 'edited' in patch) delete next.edited;
  return { ...b, months: { ...b.months, [month]: next } };
}

function nextBlueprint(current: SipBlueprint | null, op: string, p: Params): SipBlueprint | null {
  const month = str(p, 'month');
  if (op !== 'save' && op !== 'clear' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Which month?');
  switch (op) {
    case 'save': {
      // The whole plan from the setup flow or the edit sheet. A month nobody has started takes it straight away.
      const saved = JSON.parse(str(p, 'blueprint')) as SipBlueprint;
      const months = { ...current?.months };
      const running = str(p, 'month');
      const started = running ? months[running] : undefined;
      if (started && !Object.keys(started.done).length) delete months[running];
      // The phone sends only what the form shows, so what it does not (the preset name, return assumptions, the
      // step-up) stays as it was, and a plan with no preset yet reads as the styles do not match: custom.
      return {
        ...saved,
        preset: saved.preset ?? current?.preset ?? 'custom',
        since: current?.since ?? saved.since,
        stepUp: saved.stepUp ?? current?.stepUp,
        returns: saved.returns ?? current?.returns,
        months,
      };
    }
    case 'clear':
      return null;
    case 'done': {
      const b = requireBlueprint(current);
      const k = sipClass(p);
      const amount = num(p, 'amount');
      if (amount === null || amount < 0) throw new Error('How much went in?');
      const date = str(p, 'date');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      const base = monthRecord(b, month, p);
      return withMonth(b, month, { done: { ...base.done, [k]: { amount, date } } }, base);
    }
    case 'undone': {
      const b = requireBlueprint(current);
      const k = sipClass(p);
      const base = monthRecord(b, month, p);
      const { [k]: _gone, ...rest } = base.done;
      return withMonth(b, month, { done: rest }, base);
    }
    case 'plan': {
      // A stepper change: the row the person moved, with the difference spread over the rows that are not done.
      const b = requireBlueprint(current);
      const base = monthRecord(b, month, p);
      const k = sipClass(p);
      const amount = num(p, 'amount');
      if (amount === null || amount < 0) throw new Error('Enter an amount.');
      const locked = SIP_CLASSES.filter((c) => base.done[c] !== undefined);
      const plan = rebalanceEdit(base.plan, k, amount, base.budget, b.targets, locked);
      return withMonth(b, month, { plan, edited: true }, base);
    }
    case 'resetPlan': {
      const b = requireBlueprint(current);
      const base = monthRecord(b, month, p);
      const suggested = JSON.parse(str(p, 'plan')) as Record<SipClass, number>;
      return withMonth(b, month, { plan: suggested, edited: undefined }, base);
    }
    case 'strict': {
      // The rebalance switch. A month nobody has hand-edited follows it straight away.
      const b = requireBlueprint(current);
      const strict = p.strict === true || p.strict === 'true';
      const next: SipBlueprint = { ...b, strict };
      const snapshot = b.months[month];
      if (snapshot && !snapshot.edited) {
        const suggested = JSON.parse(str(p, 'plan') || '{}') as Record<SipClass, number>;
        if (SIP_CLASSES.every((k) => typeof suggested[k] === 'number')) next.months = { ...b.months, [month]: { ...snapshot, plan: suggested } };
      }
      return next;
    }
    case 'assumptions': {
      const b = requireBlueprint(current);
      const stepUp = num(p, 'stepUp');
      const returns = JSON.parse(str(p, 'returns') || '{}') as Record<string, number>;
      const kept: Partial<Record<SipClass, number>> = {};
      for (const k of SIP_CLASSES) if (typeof returns[k] === 'number' && Number.isFinite(returns[k])) kept[k] = returns[k];
      return { ...b, stepUp: stepUp ?? b.stepUp, returns: kept };
    }
    case 'notify': {
      const b = requireBlueprint(current);
      return { ...b, notify: p.notify === true || p.notify === 'true' };
    }
    default:
      throw new Error(`Unknown SIP change: ${op}`);
  }
}

/**
 * Every Zakat change: setup, settings, manual amounts, payments and closing a year. [inputs] are the public rates the
 * year is closed with; [asOf] is the device's today.
 */
export function mutateZakat(account: PortfolioAccount, op: string, p: Params, inputs: ZakatInputs, asOf: string): PortfolioAccount {
  const book = accountZakat(account);
  const need = (): ZakatBook => {
    if (!book) throw new Error('Set up zakat first.');
    return book;
  };
  const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let next: ZakatBook | null;
  if (op === 'setup') {
    const startDate = str(p, 'startDate');
    if (!isIsoDate(startDate)) throw new Error('Pick your zakat date.');
    const school = (str(p, 'school') || 'hanafi') as ZakatSchool;
    const fresh = newBook(startDate);
    const settings = applySchool(fresh.settings, school);
    next = { ...fresh, settings: { ...settings, shares: p.shares === 'proxy25' ? 'proxy25' : 'market', equityFunds: p.shares === 'proxy25' ? 'proxy25' : 'market' } };
  } else if (op === 'remove') {
    next = null;
  } else if (op === 'item') {
    const b = need();
    const kind = str(p, 'kind') as ZakatManualKind;
    const amount = num(p, 'amount');
    if (!MANUAL_KINDS.includes(kind)) throw new Error('Choose what this amount is.');
    if (amount === null || amount < 0) throw new Error('Enter the amount in rupees.');
    const id = str(p, 'id') || stamp();
    const item = { id, kind, amount, asOf, note: str(p, 'note').slice(0, 120) };
    next = { ...b, items: b.items.some((x) => x.id === id) ? b.items.map((x) => (x.id === id ? item : x)) : [...b.items, item] };
  } else if (op === 'item.remove') {
    const b = need();
    next = { ...b, items: b.items.filter((x) => x.id !== str(p, 'id')) };
  } else if (op === 'payment') {
    const b = need();
    const kind = (str(p, 'kind') || 'direct') as ZakatPaymentKind;
    const amount = num(p, 'amount');
    const date = str(p, 'date') || asOf;
    if (!PAYMENT_KINDS.includes(kind)) throw new Error('Choose how you paid.');
    if (amount === null || amount <= 0) throw new Error('Enter the amount you paid.');
    if (!isIsoDate(date)) throw new Error('Enter the date you paid.');
    next = { ...b, payments: [...b.payments, { id: stamp(), date, amount, kind, note: str(p, 'note').slice(0, 120) }] };
  } else if (op === 'payment.void') {
    const b = need();
    next = { ...b, payments: b.payments.map((x) => (x.id === str(p, 'id') ? { ...x, voided: true } : x)) };
  } else if (op === 'close') {
    const b = need();
    const parts = account.portfolios;
    next = closeYear(b, zakatBreakdown(parts, b, inputs, asOf), asOf, p.carryExtra === true);
  } else if (op === 'trail') {
    const b = need();
    next = recordTrail(b, asOf, zakatBreakdown(account.portfolios, b, inputs, asOf).zakat);
  } else {
    throw new Error(`Unknown zakat change: ${op}`);
  }
  if (next !== null) validateZakat(next);
  return setAccountZakat(account, next);
}
