// Zakat tracking. Pure, shared by web and the native apps: no React, no I/O, no clock (`asOf` is always passed in).
//
// A person picks the day their zakat year starts. The year is lunar (Hijri) by default, so every year's due date is the
// same Hijri day. During the year the page shows "what you would owe if your zakat day were today", worked out from the
// held assets (valued exactly as Holdings values them) plus a few amounts the app cannot see (cash, bank, debts). Payments
// made during the year count toward it (advance payment). On the due date the year is closed and the amount locked.
//
// Everything lives inside the encrypted portfolio (`Portfolio.zakat`); nothing here is sent to the server. Defaults follow
// Hanafi practice as taught in Pakistan; the settings let the person change the schools' differing rules. This is a
// calculator, not a fatwa.
import { valueAsset, type Asset } from './assets.ts';
import type { FxRateRow } from './fx-rates.ts';
import { chooseRate, type MetalRateRow } from './metal-rates.ts';
import type { FundNavRow } from './mufap.ts';
import type { PlanNavRow } from './plans.ts';
import { holdings, positionTimeline, round, type DisplayPart } from './portfolio.ts';
import { pktDate, type PricePoint } from './price-history.ts';

export const TOLA_SILVER_NISAB = 52.5;
export const TOLA_GOLD_NISAB = 7.5;
export const ZAKAT_RATE_LUNAR = 0.025;
/** 2.5% scaled by 365.25 / 354.37: the lunar year is about 11 days shorter, so a solar-year payer pays slightly more. */
export const ZAKAT_RATE_SOLAR = (0.025 * 365.25) / 354.37;
/** Share of a share's or equity fund's market value counted when it is held long term for dividends and the company's own figure is unknown. */
export const PROXY_SHARE = 0.25;
/** The government's nisab for the 1 Ramadan 1447 bank deduction (Feb 2026), used for information and as a fallback when no metal rate is loaded. */
export const OFFICIAL_NISAB = { hijriYear: 1447, amount: 503_529 } as const;

export const MAX_ZAKAT_PAYMENTS = 2000;
export const MAX_ZAKAT_ITEMS = 100;
export const MAX_ZAKAT_YEARS = 80;
export const MAX_TRAIL = 120;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1e12;

export type ZakatSchool = 'hanafi' | 'shafii' | 'maliki' | 'hanbali' | 'custom';
export type ZakatSettings = {
  /** Gregorian date the person picked as their zakat date (the day their first year started). */
  startDate: string;
  /** Moon sighting in Pakistan can differ from the calendar by a day or two. */
  dueShiftDays?: -2 | -1 | 0 | 1 | 2;
  year: 'lunar' | 'solar';
  nisab: 'silver' | 'gold';
  school: ZakatSchool;
  /** Shares: full market value (bought for growth) or the zakatable share of the company (long term, for dividends). */
  shares: 'market' | 'proxy25';
  equityFunds: 'market' | 'proxy25';
  plans: 'include' | 'exclude';
  jewellery: 'include' | 'exclude';
  debts: 'deduct' | 'none';
  /** Portfolios that are the person's own. Empty means all of them. */
  portfolioIds: string[];
  /** Per company: its own treatment. */
  overrides?: Record<string, 'market' | 'proxy25' | 'exclude'>;
  remind: { due: boolean; cz50: boolean; ramadan: boolean };
};
export const MANUAL_KINDS = ['cash', 'bank', 'jewellery', 'receivable', 'property', 'other', 'debt'] as const;
export type ZakatManualKind = (typeof MANUAL_KINDS)[number];
export type ZakatManualItem = {
  id: string;
  kind: ZakatManualKind;
  amount: number;
  /** The day this amount was last checked. */
  asOf: string;
  note: string;
};
export const PAYMENT_KINDS = ['direct', 'organisation', 'bank', 'deducted', 'other'] as const;
export type ZakatPaymentKind = (typeof PAYMENT_KINDS)[number];
export type ZakatPayment = {
  id: string;
  date: string;
  amount: number;
  kind: ZakatPaymentKind;
  note: string;
  voided?: boolean;
};
export type ZakatRow = {
  key: string;
  label: string;
  detail: string;
  value: number;
  /** Rupees of `value` that count toward zakat. */
  counted: number;
  /** Fraction of value that counts (1, 0.25 or 0); mixed rows show the blend. */
  share: number;
  kind: 'asset' | 'manual' | 'debt';
};
export type ZakatBreakdown = {
  asOf: string;
  rows: ZakatRow[];
  gross: number;
  debts: number;
  net: number;
  nisab: { value: number; basis: 'silver' | 'gold' | 'official'; rateDate: string | null };
  aboveNisab: boolean;
  rate: number;
  zakat: number;
  /** The same wealth with every share and equity fund at the other treatment, for one honest comparison line. */
  otherMethodZakat: number | null;
  /** Things that could not be valued, in words. Never counted as zero silently. */
  missing: string[];
  /** Stocks were valued with the closing prices of `asOf` (not the latest prices). */
  valuedOnDay?: boolean;
};
export type ZakatYear = {
  id: string;
  start: string;
  due: string;
  closedAt: string;
  amountDue: number;
  carriedIn: number;
  /** The figures the amount was worked out from, frozen at closing. */
  snapshot: Pick<ZakatBreakdown, 'rows' | 'gross' | 'debts' | 'net' | 'nisab' | 'rate' | 'zakat' | 'valuedOnDay'> & { asOf: string; settings: Pick<ZakatSettings, 'year' | 'nisab' | 'school' | 'shares' | 'equityFunds' | 'plans' | 'jewellery' | 'debts'> };
};
export type ZakatTrailPoint = { date: string; zakat: number };
export type ZakatBook = {
  version: 1;
  settings: ZakatSettings;
  items: ZakatManualItem[];
  payments: ZakatPayment[];
  years: ZakatYear[];
  /** Weekly estimates recorded while the page was open, so the chart can show how the amount moved. */
  trail: ZakatTrailPoint[];
  /** Overpayment carried from the last closed year into the open one. */
  carriedIn?: number;
};

// ───────────────────────── Hijri calendar ─────────────────────────
// The tabular (arithmetic) Islamic calendar: the same on every device and in the Android engine, no tables to ship. It can
// differ from Pakistan's moon sighting by a day or two, which is why a due date can be nudged.

const ISLAMIC_EPOCH = 1948439.5;
const UNIX_JD = 2440587.5;
export type HijriDate = { year: number; month: number; day: number };
export const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  'Rabi I',
  'Rabi II',
  'Jumada I',
  'Jumada II',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qa'dah",
  'Dhu al-Hijjah',
] as const;

const hijriJd = (year: number, month: number, day: number) =>
  day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + ISLAMIC_EPOCH - 1;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const dateFromDayNumber = (n: number) => new Date(Math.round(n) * 86_400_000).toISOString().slice(0, 10);

export function toHijri(date: string): HijriDate {
  const jd = Math.floor(dayNumber(date) + UNIX_JD) + 0.5;
  const year = Math.floor((30 * (jd - ISLAMIC_EPOCH) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jd - (29 + hijriJd(year, 1, 1))) / 29.5) + 1);
  return { year, month, day: jd - hijriJd(year, month, 1) + 1 };
}
export function fromHijri({ year, month, day }: HijriDate): string {
  const length = hijriJd(year + (month === 12 ? 1 : 0), month === 12 ? 1 : month + 1, 1) - hijriJd(year, month, 1);
  const d = Math.min(day, length);
  return dateFromDayNumber(hijriJd(year, month, d) - UNIX_JD);
}
export const hijriLabel = (h: HijriDate) => `${h.day} ${HIJRI_MONTHS[h.month - 1]} ${h.year}`;
export const hijriDayMonth = (h: HijriDate) => `${h.day} ${HIJRI_MONTHS[h.month - 1]}`;

export const addDays = (date: string, days: number) => dateFromDayNumber(dayNumber(date) + days);
export const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));
const addYears = (date: string, years: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
};

/** First day of the Hijri month `month` of year `year`, as a date, for the Ramadan marker and the CZ-50 deadline. */
export const firstOfHijriMonth = (year: number, month: number) => fromHijri({ year, month, day: 1 });

// ───────────────────────── Zakat years ─────────────────────────

/** Start of year number `index` (0 is the first year, starting on the person's zakat date). */
export function yearStart(settings: ZakatSettings, index: number): string {
  if (settings.year === 'solar') return addYears(settings.startDate, index);
  const h = toHijri(settings.startDate);
  const base = fromHijri({ year: h.year + index, month: h.month, day: h.day });
  return index === 0 ? settings.startDate : addDays(base, settings.dueShiftDays ?? 0);
}
export const yearDue = (settings: ZakatSettings, index: number) => yearStart(settings, index + 1);

/** The first year without a closed record: the one still being tracked. */
export function openYearIndex(book: ZakatBook): number {
  return book.years.length;
}
export type YearWindow = { index: number; start: string; due: string };
export function openYear(book: ZakatBook): YearWindow {
  const index = openYearIndex(book);
  return { index, start: yearStart(book.settings, index), due: yearDue(book.settings, index) };
}
export function hijriYearName(window: YearWindow): string {
  const a = toHijri(window.start).year;
  return `${a}–${String((a + 1) % 100).padStart(2, '0')}`;
}

export function defaultSettings(startDate: string): ZakatSettings {
  return {
    startDate,
    year: 'lunar',
    nisab: 'silver',
    school: 'hanafi',
    shares: 'market',
    equityFunds: 'market',
    plans: 'include',
    jewellery: 'include',
    debts: 'deduct',
    portfolioIds: [],
    remind: { due: true, cz50: true, ramadan: true },
  };
}
export const newBook = (startDate: string): ZakatBook => ({
  version: 1,
  settings: defaultSettings(startDate),
  items: [],
  payments: [],
  years: [],
  trail: [],
});

/** What each school's usual rulings change; "custom" keeps whatever the person set. */
export function applySchool(settings: ZakatSettings, school: ZakatSchool): ZakatSettings {
  if (school === 'custom') return { ...settings, school };
  const hanafi = school === 'hanafi';
  return {
    ...settings,
    school,
    nisab: hanafi ? 'silver' : 'gold',
    jewellery: hanafi ? 'include' : 'exclude',
    debts: school === 'shafii' ? 'none' : 'deduct',
  };
}

// ───────────────────────── Breakdown ─────────────────────────

/** Equity-type funds hold company shares, so the long-term-for-dividends method can apply; money market, income and gold funds hold cash, sukuk or metal and count in full. Unknown wording counts as equity (the same rule Insights uses). */
export function isEquityFund(category: string): boolean {
  const c = category.toLowerCase();
  if (/gold/.test(c)) return false;
  if (/money market|income|fixed|sovereign|treasury|cash|savings|capital protected|capital preservation/.test(c)) return false;
  return true;
}

export type ZakatInputs = {
  metalRates?: MetalRateRow[];
  fundNavs?: FundNavRow[];
  planNavs?: PlanNavRow[];
  fxRates?: FxRateRow[];
  /** Daily closes per ticker. With them, stocks are valued on `asOf` itself (shares held then times the close on or before it). */
  closes?: Record<string, PricePoint[]>;
};

const stockShare = (settings: ZakatSettings, ticker: string, treatment: 'market' | 'proxy25') => {
  const o = settings.overrides?.[ticker];
  const t = o ?? treatment;
  return t === 'exclude' ? 0 : t === 'proxy25' ? PROXY_SHARE : 1;
};

const MANUAL_LABELS: Record<ZakatManualKind, string> = {
  cash: 'Cash at home',
  bank: 'Bank balances',
  jewellery: 'Jewellery you wear',
  receivable: 'Money owed to you',
  property: 'Property to resell',
  other: 'Other zakatable wealth',
  debt: 'Debts due in the next 12 months',
};
export const manualLabel = (kind: ZakatManualKind) => MANUAL_LABELS[kind];

function nisabFor(settings: ZakatSettings, rates: MetalRateRow[], asOf: string): ZakatBreakdown['nisab'] {
  const metal = settings.nisab;
  const rate = chooseRate(rates, metal, asOf);
  if (!rate) return { value: OFFICIAL_NISAB.amount, basis: 'official', rateDate: null };
  const tolas = metal === 'silver' ? TOLA_SILVER_NISAB : TOLA_GOLD_NISAB;
  return { value: round(rate.pkrPerTola * tolas), basis: metal, rateDate: rate.date };
}

/** Open stock positions with their value: on `asOf` from the daily closes when given, otherwise at the latest price. */
function stockPositions(portfolio: Parameters<typeof holdings>[0], asOf: string, closes?: Record<string, PricePoint[]>) {
  const now = holdings(portfolio).filter((x) => x.shares > 0);
  if (!closes) return now.map((h) => ({ ticker: h.ticker, value: h.value, onDay: false }));
  const out: { ticker: string; value: number | null | undefined; onDay: boolean }[] = [];
  for (const company of portfolio.companies) {
    const timeline = positionTimeline(portfolio, company.ticker);
    let shares = 0;
    for (const point of timeline) if (point.date <= asOf) shares = point.shares;
    if (shares <= 0) continue;
    let close: number | null = null;
    for (const [sec, price] of closes[company.ticker] ?? []) if (pktDate(sec) <= asOf && price > 0) close = price;
    if (close !== null) out.push({ ticker: company.ticker, value: shares * close, onDay: true });
    // No history for that day: the latest price stands in and the snapshot says so.
    else out.push({ ticker: company.ticker, value: now.find((h) => h.ticker === company.ticker)?.value ?? null, onDay: false });
  }
  return out;
}

function wealth(
  parts: (DisplayPart & { locked?: boolean })[],
  book: ZakatBook,
  inputs: ZakatInputs,
  asOf: string,
  treatment: { shares: 'market' | 'proxy25'; equityFunds: 'market' | 'proxy25' },
) {
  const { settings } = book;
  const chosen = settings.portfolioIds.length ? parts.filter((p) => settings.portfolioIds.includes(p.id)) : parts;
  const rows: ZakatRow[] = [];
  const missing: string[] = [];
  const put = (row: Omit<ZakatRow, 'share'>) => {
    if (row.value === 0 && row.counted === 0) return;
    rows.push({ ...row, share: row.value > 0 ? row.counted / row.value : 0 });
  };

  // Stocks: each position at its market value, counted by the person's rule for that company.
  let stockValue = 0;
  let stockCounted = 0;
  let stockCount = 0;
  const unpriced: string[] = [];
  let onDay = Boolean(inputs.closes);
  for (const part of chosen)
    for (const h of stockPositions(part.portfolio, asOf, inputs.closes)) {
      if (h.value === null || h.value === undefined) {
        unpriced.push(h.ticker);
        continue;
      }
      if (!h.onDay) onDay = false;
      stockCount += 1;
      stockValue += h.value;
      stockCounted += h.value * stockShare(settings, h.ticker, treatment.shares);
    }
  if (unpriced.length) missing.push(`No price for ${[...new Set(unpriced)].join(', ')}`);
  put({
    key: 'stocks',
    label: 'Stocks',
    detail:
      treatment.shares === 'market'
        ? `${stockCount} ${stockCount === 1 ? 'company' : 'companies'} · full market value`
        : `${stockCount} ${stockCount === 1 ? 'company' : 'companies'} · ${Math.round(PROXY_SHARE * 100)}% held for dividends`,
    value: round(stockValue),
    counted: round(stockCounted),
    kind: 'asset',
  });

  // Everything else, valued per asset the way Holdings does, then grouped.
  const groups = new Map<string, { label: string; detail: string; value: number; counted: number; n: number }>();
  const add = (key: string, label: string, detail: string, value: number, counted: number) => {
    const g = groups.get(key) ?? { label, detail, value: 0, counted: 0, n: 0 };
    g.value += value;
    g.counted += counted;
    g.n += 1;
    groups.set(key, g);
  };
  for (const part of chosen)
    for (const asset of (part.portfolio.assets ?? []) as Asset[]) {
      const v = valueAsset(
        asset,
        inputs.metalRates ?? [],
        asOf,
        inputs.fundNavs ?? [],
        inputs.planNavs ?? [],
        inputs.fxRates ?? [],
      );
      if (!v.open && !(v.value && v.value > 0)) continue;
      if (v.value === null) {
        missing.push(`No value for ${asset.name}`);
        continue;
      }
      if (v.classKey === 'funds' && asset.kind === 'fund') {
        const growth = isEquityFund(asset.category);
        const share = growth && treatment.equityFunds === 'proxy25' ? PROXY_SHARE : 1;
        add(
          growth ? 'funds-equity' : 'funds-stable',
          growth ? 'Equity funds' : 'Money market and income funds',
          growth
            ? treatment.equityFunds === 'market' ? 'Valued at repurchase price' : `${Math.round(PROXY_SHARE * 100)}% held for dividends`
            : 'Cash and sukuk: full value',
          v.value,
          v.value * share,
        );
      } else if (v.classKey === 'plans') {
        add('plans', 'Savings plans', 'Value you could take out (estimate)', v.value, settings.plans === 'include' ? v.value : 0);
      } else if (v.classKey === 'gold') add('gold', 'Gold', 'At the dealer rate for its purity', v.value, v.value);
      else if (v.classKey === 'silver') add('silver', 'Silver', 'At the dealer rate for its purity', v.value, v.value);
      else if (v.classKey === 'currency') add('currency', 'Foreign currency', 'At the open-market buying rate', v.value, v.value);
    }
  for (const [key, g] of groups)
    put({ key, label: g.label, detail: g.detail, value: round(g.value), counted: round(g.counted), kind: 'asset' });

  // What the app cannot see.
  let debts = 0;
  for (const item of book.items) {
    if (item.kind === 'debt') {
      debts += settings.debts === 'deduct' ? item.amount : 0;
      put({
        key: item.id,
        label: item.note || manualLabel('debt'),
        detail: settings.debts === 'deduct' ? 'Deducted' : 'Not deducted in this school',
        value: item.amount,
        counted: settings.debts === 'deduct' ? item.amount : 0,
        kind: 'debt',
      });
      continue;
    }
    const counted = item.kind === 'jewellery' && settings.jewellery === 'exclude' ? 0 : item.amount;
    put({
      key: item.id,
      label: item.note ? `${manualLabel(item.kind)} · ${item.note}` : manualLabel(item.kind),
      detail: counted === 0 ? 'Not counted in this school' : `You entered, ${item.asOf}`,
      value: item.amount,
      counted,
      kind: 'manual',
    });
  }
  const gross = round(rows.filter((r) => r.kind !== 'debt').reduce((n, r) => n + r.counted, 0));
  return { rows, gross, debts: round(debts), missing, onDay };
}

export function zakatBreakdown(
  parts: (DisplayPart & { locked?: boolean })[],
  book: ZakatBook,
  inputs: ZakatInputs,
  asOf: string,
): ZakatBreakdown {
  const { settings } = book;
  const main = wealth(parts, book, inputs, asOf, { shares: settings.shares, equityFunds: settings.equityFunds });
  const nisab = nisabFor(settings, inputs.metalRates ?? [], asOf);
  const rate = settings.year === 'solar' ? ZAKAT_RATE_SOLAR : ZAKAT_RATE_LUNAR;
  const net = round(main.gross - main.debts);
  const above = net >= nisab.value && net > 0;
  const zakat = above ? round(net * rate) : 0;
  // The other way of counting shares and equity funds, shown as one comparison line (never silently applied).
  const flip = (t: 'market' | 'proxy25') => (t === 'market' ? 'proxy25' : 'market');
  const other = wealth(parts, book, inputs, asOf, { shares: flip(settings.shares), equityFunds: flip(settings.equityFunds) });
  const otherNet = round(other.gross - other.debts);
  const otherZakat = otherNet >= nisab.value && otherNet > 0 ? round(otherNet * rate) : 0;
  const hasEquity = main.rows.some((r) => r.key === 'stocks' || r.key === 'funds-equity');
  return {
    asOf,
    rows: main.rows,
    gross: main.gross,
    debts: main.debts,
    net,
    nisab,
    aboveNisab: above,
    rate,
    zakat,
    otherMethodZakat: hasEquity && otherZakat !== zakat ? otherZakat : null,
    missing: main.missing,
    ...(inputs.closes ? { valuedOnDay: main.onDay } : {}),
  };
}

// ───────────────────────── Payments and progress ─────────────────────────

export const activePayments = (book: ZakatBook) =>
  book.payments.filter((p) => !p.voided).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

/**
 * Which year each payment counts toward. A payment goes to the year whose window holds its date; one dated after a closed
 * year's due date first clears whatever that closed year still lacks (oldest first), then counts toward the open year.
 */
export type AllocatedPayment = ZakatPayment & {
  /** The closed year it first helps, or the open year's index when none. */
  yearIndex: number;
  /** Rupees of it that count toward the open year (the rest cleared a closed year's balance). */
  openAmount: number;
};
export function allocatePayments(book: ZakatBook): { paid: number[]; openPaid: number; payments: AllocatedPayment[] } {
  const closed = book.years.length;
  const paid = book.years.map(() => 0);
  let openPaid = 0;
  const out: AllocatedPayment[] = [];
  for (const p of activePayments(book)) {
    let index = closed;
    for (let i = 0; i < closed; i++)
      if (p.date < book.years[i].due) {
        index = i;
        break;
      }
    if (index < closed) {
      paid[index] += p.amount;
      out.push({ ...p, yearIndex: index, openAmount: 0 });
      continue;
    }
    let left = p.amount;
    let first = closed;
    for (let i = 0; i < closed && left > 0; i++) {
      const lack = Math.max(0, book.years[i].amountDue - book.years[i].carriedIn - paid[i]);
      const take = Math.min(lack, left);
      if (take > 0 && first === closed) first = i;
      paid[i] += take;
      left -= take;
    }
    openPaid += left;
    out.push({ ...p, yearIndex: first, openAmount: left });
  }
  return { paid, openPaid: round(openPaid), payments: out };
}

export type ZakatProgress = {
  year: YearWindow;
  name: string;
  estimate: number;
  paid: number;
  remaining: number;
  /** Paid beyond the estimate. */
  extra: number;
  percentPaid: number;
  daysLeft: number;
  /** The due date has passed and the year has not been closed. */
  closeDue: boolean;
  /** Days from the year's start to today, and the whole year, for the year bar. */
  elapsed: number;
  length: number;
  carriedIn: number;
  past: { id: string; name: string; due: string; amountDue: number; paid: number; remaining: number }[];
  /** What closed years still lack, to show next to the open year. */
  arrears: number;
};

export function zakatProgress(book: ZakatBook, breakdown: ZakatBreakdown, asOf: string): ZakatProgress {
  const year = openYear(book);
  const alloc = allocatePayments(book);
  const carriedIn = book.carriedIn ?? 0;
  const paid = round(alloc.openPaid + carriedIn);
  const estimate = breakdown.zakat;
  const past = book.years.map((y, i) => {
    const name = `${toHijri(y.start).year}–${String((toHijri(y.start).year + 1) % 100).padStart(2, '0')}`;
    const p = round(alloc.paid[i] + y.carriedIn);
    return { id: y.id, name, due: y.due, amountDue: y.amountDue, paid: p, remaining: Math.max(0, round(y.amountDue - p)) };
  });
  const length = Math.max(1, daysBetween(year.start, year.due));
  return {
    year,
    name: hijriYearName(year),
    estimate,
    paid,
    remaining: Math.max(0, round(estimate - paid)),
    extra: Math.max(0, round(paid - estimate)),
    percentPaid: estimate > 0 ? Math.min(100, Math.round((paid / estimate) * 100)) : paid > 0 ? 100 : 0,
    daysLeft: daysBetween(asOf, year.due),
    closeDue: asOf >= year.due,
    elapsed: Math.max(0, Math.min(length, daysBetween(year.start, asOf))),
    length,
    carriedIn,
    past,
    arrears: round(past.reduce((n, y) => n + y.remaining, 0)),
  };
}

/** Locks the open year at the amount worked out now and starts the next one. The surplus is carried forward only when asked. */
export function closeYear(book: ZakatBook, breakdown: ZakatBreakdown, asOf: string, carryExtra = false): ZakatBook {
  const year = openYear(book);
  const alloc = allocatePayments(book);
  const carriedIn = book.carriedIn ?? 0;
  const closed: ZakatYear = {
    id: `y${year.index}`,
    start: year.start,
    due: year.due,
    closedAt: asOf,
    amountDue: breakdown.zakat,
    carriedIn,
    snapshot: {
      asOf: breakdown.asOf,
      rows: breakdown.rows,
      gross: breakdown.gross,
      debts: breakdown.debts,
      net: breakdown.net,
      nisab: breakdown.nisab,
      rate: breakdown.rate,
      zakat: breakdown.zakat,
      ...(breakdown.valuedOnDay !== undefined ? { valuedOnDay: breakdown.valuedOnDay } : {}),
      settings: {
        year: book.settings.year,
        nisab: book.settings.nisab,
        school: book.settings.school,
        shares: book.settings.shares,
        equityFunds: book.settings.equityFunds,
        plans: book.settings.plans,
        jewellery: book.settings.jewellery,
        debts: book.settings.debts,
      },
    },
  };
  const surplus = Math.max(0, round(alloc.openPaid + carriedIn - breakdown.zakat));
  const { carriedIn: _old, ...rest } = book;
  return {
    ...rest,
    years: [...book.years, closed],
    trail: [],
    ...(carryExtra && surplus > 0 ? { carriedIn: surplus } : {}),
    // Payments made after this year's due date count toward the next year; those inside it already belong to the closed one.
  };
}

/** True once a zakat day has passed with its year still open: the amount is due to be fixed from that day's values. */
export const lockPending = (book: ZakatBook, today: string) => openYear(book).due < today;

/**
 * Fixes every year whose zakat day has passed, each from the portfolio as it stood on that day (stocks from `inputs.closes`
 * when given). A year is never fixed from a later day's values by accident: without closes the snapshot says it used the
 * latest prices. Money paid beyond a year's amount carries into the next one.
 */
export function lockDueYears(
  book: ZakatBook,
  parts: (DisplayPart & { locked?: boolean })[],
  inputs: ZakatInputs,
  today: string,
): ZakatBook {
  let next = book;
  for (let i = 0; i < MAX_ZAKAT_YEARS && lockPending(next, today); i += 1) {
    const { due } = openYear(next);
    next = closeYear(next, zakatBreakdown(parts, next, inputs, due), today, true);
  }
  return next;
}

// ───────────────────────── The trail chart ─────────────────────────

/** True when this week's estimate has not been recorded yet. */
export function shouldRecordTrail(book: ZakatBook, asOf: string): boolean {
  const last = book.trail[book.trail.length - 1];
  const year = openYear(book);
  return asOf >= year.start && asOf < year.due && (!last || daysBetween(last.date, asOf) >= 7);
}
export function recordTrail(book: ZakatBook, asOf: string, zakat: number): ZakatBook {
  if (!shouldRecordTrail(book, asOf)) return book;
  return { ...book, trail: [...book.trail, { date: asOf, zakat }].slice(-MAX_TRAIL) };
}

/** Cumulative payments as a step line over the open year: [date, total paid] pairs. */
export function paidSteps(book: ZakatBook): [string, number][] {
  const year = openYear(book);
  let total = book.carriedIn ?? 0;
  const out: [string, number][] = [[year.start, total]];
  for (const p of allocatePayments(book).payments) {
    if (p.openAmount <= 0) continue;
    total += p.openAmount;
    out.push([p.date < year.start ? year.start : p.date, round(total)]);
  }
  return out;
}

// ───────────────────────── Reminders ─────────────────────────

export type ZakatReminder = { id: 'due' | 'cz50' | 'ramadan'; date: string; title: string; body: string };
/** The reminder dates coming up from `asOf` (local only: nothing here goes to the server). */
export function upcomingReminders(book: ZakatBook, asOf: string): ZakatReminder[] {
  const out: ZakatReminder[] = [];
  const year = openYear(book);
  const r = book.settings.remind;
  if (r.due) {
    const day = addDays(year.due, -7);
    out.push({ id: 'due', date: day, title: 'Your zakat day is in a week', body: 'Check your bank and cash amounts so the figure is right.' });
  }
  const h = toHijri(asOf);
  const ramadanYear = h.month > 9 || (h.month === 9 && h.day > 1) ? h.year + 1 : h.year;
  const ramadan = firstOfHijriMonth(ramadanYear, 9);
  if (r.cz50)
    out.push({ id: 'cz50', date: addDays(ramadan, -30), title: 'CZ-50 deadline', body: 'File Form CZ-50 with your bank today if you want to pay zakat yourself instead of the bank deduction on 1 Ramadan.' });
  if (r.ramadan)
    out.push({ id: 'ramadan', date: ramadan, title: '1 Ramadan', body: 'If your bank deducted zakat today, log it as a payment.' });
  return out.filter((x) => x.date >= asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ───────────────────────── Validation ─────────────────────────

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const SCHOOLS: ZakatSchool[] = ['hanafi', 'shafii', 'maliki', 'hanbali', 'custom'];

/** Throws a message for the first thing wrong with a zakat book; used by the ledger validator. */
export function validateZakat(z: unknown): asserts z is ZakatBook {
  const bad = (why: string): never => {
    throw new Error(`Invalid zakat records: ${why}.`);
  };
  if (!z || typeof z !== 'object') return bad('not an object');
  const x = z as Partial<ZakatBook>;
  if (x.version !== 1) bad('version');
  const s = x.settings;
  if (!s || typeof s !== 'object') return bad('settings');
  if (typeof s.startDate !== 'string' || !DATE.test(s.startDate) || Number.isNaN(Date.parse(s.startDate))) bad('zakat date');
  if (s.year !== 'lunar' && s.year !== 'solar') bad('year type');
  if (s.nisab !== 'silver' && s.nisab !== 'gold') bad('nisab');
  if (!SCHOOLS.includes(s.school as ZakatSchool)) bad('school');
  if (!['market', 'proxy25'].includes(s.shares as string) || !['market', 'proxy25'].includes(s.equityFunds as string)) bad('share treatment');
  if (!['include', 'exclude'].includes(s.plans as string) || !['include', 'exclude'].includes(s.jewellery as string)) bad('inclusions');
  if (!['deduct', 'none'].includes(s.debts as string)) bad('debts');
  if (s.dueShiftDays !== undefined && ![-2, -1, 0, 1, 2].includes(s.dueShiftDays)) bad('due date shift');
  if (!Array.isArray(s.portfolioIds) || s.portfolioIds.length > 20 || s.portfolioIds.some((i) => typeof i !== 'string')) bad('portfolios');
  if (s.overrides !== undefined) {
    if (!s.overrides || typeof s.overrides !== 'object' || Object.keys(s.overrides).length > 500) bad('overrides');
    for (const v of Object.values(s.overrides ?? {})) if (!['market', 'proxy25', 'exclude'].includes(v)) bad('override');
  }
  if (!s.remind || typeof s.remind.due !== 'boolean' || typeof s.remind.cz50 !== 'boolean' || typeof s.remind.ramadan !== 'boolean') bad('reminders');
  if (!Array.isArray(x.items) || x.items.length > MAX_ZAKAT_ITEMS) bad('amounts');
  for (const i of x.items ?? []) {
    if (!i || typeof i.id !== 'string' || !MANUAL_KINDS.includes(i.kind) || !finite(i.amount) || i.amount < 0 || i.amount > MAX_AMOUNT) bad('an amount');
    if (typeof i.asOf !== 'string' || !DATE.test(i.asOf) || typeof i.note !== 'string' || i.note.length > 200) bad('an amount detail');
  }
  if (!Array.isArray(x.payments) || x.payments.length > MAX_ZAKAT_PAYMENTS) bad('payments');
  const ids = new Set<string>();
  for (const p of x.payments ?? []) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) bad('payment id');
    ids.add(p.id);
    if (!finite(p.amount) || p.amount <= 0 || p.amount > MAX_AMOUNT) bad('payment amount');
    if (typeof p.date !== 'string' || !DATE.test(p.date) || Number.isNaN(Date.parse(p.date))) bad('payment date');
    if (!PAYMENT_KINDS.includes(p.kind) || typeof p.note !== 'string' || p.note.length > 200) bad('payment detail');
  }
  if (!Array.isArray(x.years) || x.years.length > MAX_ZAKAT_YEARS) bad('years');
  for (const y of x.years ?? []) {
    if (!y || typeof y.id !== 'string' || !DATE.test(y.start) || !DATE.test(y.due) || !DATE.test(y.closedAt)) bad('a year');
    if (!finite(y.amountDue) || y.amountDue < 0 || !finite(y.carriedIn) || y.carriedIn < 0) bad('a year amount');
    if (!y.snapshot || typeof y.snapshot !== 'object' || !Array.isArray(y.snapshot.rows) || y.snapshot.rows.length > 200) bad('a year record');
  }
  if (!Array.isArray(x.trail) || x.trail.length > MAX_TRAIL) bad('trail');
  for (const t of x.trail ?? []) if (!t || !DATE.test(t.date) || !finite(t.zakat) || t.zakat < 0) bad('trail point');
  if (x.carriedIn !== undefined && (!finite(x.carriedIn) || x.carriedIn < 0)) bad('carried amount');
}
