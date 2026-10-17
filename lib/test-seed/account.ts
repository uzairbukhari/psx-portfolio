// The fictional account the automated tests sign in with: four portfolios that between them touch every kind of
// record the app knows about. Dates are relative to `today` (PKT, YYYY-MM-DD) so the ledger's "no future dates"
// rules always pass. tests/test-seed.test.mjs fails when a new enum value (trade kind, dividend flavour, asset kind...)
// is added to the app without being covered here, so extend this file whenever you add a feature.
import { blankPortfolio, type Company, type Dividend, type Portfolio, type Trade } from '../portfolio.ts';
import type { PortfolioAccount } from '../portfolio-account.ts';
import type { FundAsset } from '../funds.ts';
import type { MetalAsset } from '../assets.ts';
import type { CurrencyAsset } from '../currency.ts';
import type { PlanAsset } from '../plans.ts';
import { TEST_COMPANIES, TEST_FUNDS, priceOf } from './universe.ts';

/** `YYYY-MM-DD` that is `days` before `today`. */
export function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const monthOf = (date: string) => date.slice(0, 7);
const r2 = (n: number) => Math.round(n * 100) / 100;

function company(ticker: string, target: number, approved: boolean, today: string, extra: Partial<Company> = {}): Company {
  const c = TEST_COMPANIES.find((x) => x.ticker === ticker);
  if (!c) throw new Error(`Unknown test company ${ticker}`);
  return { ticker, name: c.name, sector: c.sector, target, approved, screenDate: daysAgo(today, 400), note: 'Fictional test company.', ...extra };
}

function quotes(tickers: string[], today: string, now: Date): Portfolio['quotes'] {
  return Object.fromEntries(
    tickers.map((t) => [t, { price: priceOf(t), asOf: today, date: today, source: `https://dps.psx.com.pk/company/${t}`, fetchedAt: now.toISOString() }]),
  );
}

/** Shares held on `date` from non-voided trades dated before it (ignores splits; the seed avoids dividends on split stocks). */
function heldBefore(trades: Trade[], ticker: string, date: string): number {
  return trades
    .filter((t) => !t.voided && t.ticker === ticker && t.date < date)
    .reduce((n, t) => n + (t.kind === 'sell' ? -t.shares : t.shares), 0);
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

type TradeSeed = Partial<Trade> & Pick<Trade, 'ticker' | 'kind' | 'date' | 'shares' | 'price'>;
function trade(t: TradeSeed): Trade {
  const fees = t.fees ?? (t.price && t.kind !== 'opening' ? r2(t.shares * t.price * 0.0025) : 0);
  return { id: nextId('t'), fees, month: t.kind === 'buy' && !t.source ? monthOf(t.date) : '', note: 'Fictional test trade.', ...t };
}

function ahlCore(today: string, now: Date): Portfolio {
  const d = (n: number) => daysAgo(today, n);
  const trades: Trade[] = [
    // Opening balances: one with a known cost, one whose cost is unknown.
    trade({ ticker: 'HBL', kind: 'opening', date: d(400), shares: 300, price: 140, fees: 0 }),
    trade({ ticker: 'MEBL', kind: 'opening', date: d(400), shares: 200, price: null, fees: 0 }),
    // Manual SIP buys.
    trade({ ticker: 'MEBL', kind: 'buy', date: d(330), shares: 100, price: 280 }),
    trade({ ticker: 'SYS', kind: 'buy', date: d(330), shares: 40, price: 600 }),
    trade({ ticker: 'LUCK', kind: 'buy', date: d(300), shares: 40, price: 1010 }),
    trade({ ticker: 'OGDC', kind: 'buy', date: d(280), shares: 300, price: 195 }),
    trade({ ticker: 'PPL', kind: 'buy', date: d(280), shares: 250, price: 205 }),
    trade({ ticker: 'HUBC', kind: 'buy', date: d(250), shares: 150, price: 190 }),
    trade({ ticker: 'EFERT', kind: 'buy', date: d(220), shares: 200, price: 215 }),
    trade({ ticker: 'FFC', kind: 'buy', date: d(200), shares: 120, price: 380 }),
    trade({ ticker: 'SEARL', kind: 'buy', date: d(150), shares: 500, price: 62 }),
    trade({ ticker: 'INDU', kind: 'buy', date: d(120), shares: 10, price: 2000 }),
    trade({ ticker: 'FCCL', kind: 'buy', date: d(90), shares: 600, price: 44 }),
    trade({ ticker: 'MEBL', kind: 'buy', date: d(60), shares: 50, price: 305 }),
    trade({ ticker: 'LUCK', kind: 'buy', date: d(30), shares: 20, price: 1100 }),
    trade({ ticker: 'OGDC', kind: 'buy', date: d(20), shares: 100, price: 225 }),
    trade({ ticker: 'HBL', kind: 'buy', date: d(10), shares: 100, price: 205 }),
    // Voided entry (kept for the audit trail).
    trade({ ticker: 'FFC', kind: 'buy', date: d(190), shares: 999, price: 1, voided: true, note: 'Entered by mistake.' }),
    // Sales: a gain, a loss with tax withheld, and a full exit.
    trade({ ticker: 'OGDC', kind: 'sell', date: d(100), shares: 100, price: 238, fees: 59.5 }),
    trade({ ticker: 'PPL', kind: 'sell', date: d(60), shares: 100, price: 180, fees: 45, taxWithheld: 0 }),
    trade({ ticker: 'HUBC', kind: 'sell', date: d(45), shares: 150, price: 220, fees: 82.5, taxWithheld: 495 }),
    // Broker-imported rows (AHL statement and a generic broker file) with their provenance fields.
    trade({ ticker: 'TRG', kind: 'buy', date: d(180), shares: 400, price: 70, source: 'ahl', externalId: 'ahl:seed-1', settlementDate: d(178), dateCertainty: 'confirmed', netCash: 28070, statementRef: 'seed-stmt-1' }),
    trade({ ticker: 'TRG', kind: 'sell', date: d(70), shares: 100, price: 82, source: 'ahl', externalId: 'ahl:seed-2', settlementDate: d(68), dateCertainty: 'inferred', taxWithheld: 120, netCash: 8000 }),
    trade({ ticker: 'FFC', kind: 'buy', date: d(40), shares: 30, price: 415, source: 'broker', externalId: 'broker:seed-1', accountId: 'seed-acct' }),
    // Bonus shares recorded as a broker adjustment.
    trade({ ticker: 'EFERT', kind: 'adjustment', date: d(35), shares: 20, price: null, fees: 0, source: 'broker', externalId: 'broker:seed-bonus' }),
    // An IPO allotment with an assumed (inferred) cost basis.
    trade({
      ticker: 'AIRLINK', kind: 'buy', date: d(160), shares: 500, price: 50, source: 'ipo', externalId: 'ipo:seed-airlink',
      inferred: { basis: 'ipo-offer', priceSource: 'https://dps.psx.com.pk/ipo', dateBasis: 'allotment', forSale: 'seed', label: 'Assumed from the IPO offer price (fictional).' },
    }),
  ];

  const received = (ticker: string, days: number, perShare: number, extra: Partial<Dividend> = {}): Dividend => {
    const date = d(days);
    const shares = heldBefore(trades, ticker, date);
    const gross = r2(shares * perShare);
    return { id: nextId('d'), ticker, date, source: 'manual', perShare, grossAmount: gross, taxWithheld: r2(gross * 0.15), status: 'received', note: 'Fictional dividend.', ...extra };
  };
  const basis = (shares: number, perShare: number, closure: string, announcedOn: string, pct = false) => ({
    shares, perShare, bookClosureEnd: closure, details: pct ? '25% (D) at Rs 10 face value' : `Rs ${perShare} per share`, announcedOn,
    faceValue: pct ? 10 : null, rateSource: pct ? ('percent-of-face-value' as const) : ('rupees' as const), certain: true,
  });
  const auto = (ticker: string, days: number, perShare: number, extra: Partial<Dividend>): Dividend => {
    const date = d(days);
    const shares = heldBefore(trades, ticker, date);
    // Same key the app derives from a PSX announcement (autoDividendId), so a matching public announcement is not added twice.
    const announced = d(days + 20);
    return {
      id: nextId('d'), ticker, date, source: 'auto', perShare, grossAmount: r2(shares * perShare), note: '', externalId: `psx:${ticker}:${date}:${announced}`,
      entitlementDate: d(days + 2), entitlementCertain: true, entitlement: basis(shares, perShare, date, announced, true), ...extra,
    };
  };
  const dividends: Dividend[] = [
    received('MEBL', 150, 7),
    received('HBL', 140, 6, { financialYear: '2025' }),
    received('LUCK', 120, 10, { voided: true, note: 'Voided duplicate.' }),
    // CDC-style import: net after tax, no per-share.
    { id: nextId('d'), ticker: 'OGDC', date: d(110), source: 'import', grossAmount: 1700, netAmount: 1445, externalId: 'cdc:seed-ogdc', note: 'Fictional CDC import.', status: 'received' },
    // Automatic dividends in every state.
    auto('FFC', 120, 5, { status: 'received', paymentDate: d(100), paymentDateEstimated: true, autoBatch: 'seed-batch-1', taxWithheld: 0 }),
    auto('SEARL', 100, 1, { status: 'received', paymentDateUnknown: true, receiptConfirmedAt: now.toISOString() }),
    auto('EFERT', 90, 4, { status: 'received', paymentDate: d(75), taxWithheld: 0, receiptConfirmedAt: now.toISOString() }),
    auto('OGDC', 5, 3, { status: 'expected' }),
    auto('MEBL', 3, 8, { status: 'expected', entitlementCertain: false, entitlement: { ...basis(heldBefore(trades, 'MEBL', d(3)), 8, d(3), d(23)), certain: false } }),
  ];

  const tickers = ['MEBL', 'HBL', 'LUCK', 'FCCL', 'OGDC', 'PPL', 'HUBC', 'EFERT', 'FFC', 'SYS', 'AIRLINK', 'SEARL', 'INDU', 'TRG'];
  const budgets: Record<string, number> = {};
  for (let i = 0; i < 12; i++) budgets[monthOf(daysAgo(today, i * 30))] = 100000 + i * 5000;

  return {
    ...blankPortfolio(),
    companies: tickers.map((t, i) => company(t, [15, 12, 10, 5, 10, 8, 0, 0, 8, 6, 4, 4, 6, 4][i], t !== 'HUBC', today, t === 'LUCK' ? { faceValue: 10 } : t === 'SEARL' ? { faceValue: 10, faceValueAssumed: true } : {})),
    trades,
    stockSplits: [{ id: 'split-sys', ticker: 'SYS', date: d(200), oldShares: 1, newShares: 5, note: 'Fictional 1:5 split.', source: 'manual' }],
    quotes: quotes(tickers, today, now),
    budgets,
    dividends,
    dividendTrackingFrom: d(30),
    taxProfile: { filerStatus: 'filer' },
    brokerFileHashes: ['a'.repeat(64)],
    brokerFormats: [{ broker: 'Fictional Securities', signature: 'date|scrip|side|qty|rate', report: 'trades', dateStyle: 'iso', columns: { ticker: 1, date: 0, side: 2, shares: 3, price: 4, fees: null, reference: null } }],
    monthlyPicksShortlist: ['MEBL', 'LUCK', 'FFC', 'TRG'],
    monthlyPicksList: [{ ticker: 'SNGP', name: 'Sui Northern Gas Pipelines' }],
    notifications: [
      { id: 'n1', at: now.toISOString(), kind: 'payout-announced', ticker: 'OGDC', title: 'OGDC announced a dividend', body: 'Rs 3 per share (fictional).', read: false },
      { id: 'n2', at: now.toISOString(), kind: 'dividend-recorded', ticker: 'EFERT', title: 'Dividend recorded', body: 'EFERT dividend added automatically.', read: true },
      { id: 'n3', at: now.toISOString(), kind: 'dividend-replaced', ticker: 'MEBL', title: 'Dividend replaced', body: 'An estimate was replaced by the real payment.', read: false },
      { id: 'n4', at: now.toISOString(), kind: 'info', title: 'Welcome', body: 'This is the fictional test account.', read: true, clearedAt: now.toISOString() },
    ],
    research: [
      { ticker: 'MEBL', status: 'Complete', score: 82, fairValue: 360, fairValueLow: 330, fairValueHigh: 390, thesis: 'Fictional thesis.', risks: 'Fictional risks.', catalysts: 'Fictional catalysts.', conversationUrl: '', sources: ['https://example.test/a'], financials: [{ year: '2025', revenue: 100, profit: 40, eps: 22, roe: 24, debt: 0 }], updatedAt: now.toISOString() },
      { ticker: 'LUCK', status: 'Researching', score: null, fairValue: null, fairValueLow: null, fairValueHigh: null, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: now.toISOString() },
      { ticker: 'FFC', status: 'Queue', score: null, fairValue: null, fairValueLow: null, fairValueHigh: null, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: now.toISOString() },
      { ticker: 'OGDC', status: 'Update needed', score: 64, fairValue: 250, fairValueLow: 220, fairValueHigh: 280, thesis: 'Stale fictional thesis.', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: daysAgo(today, 90) + 'T00:00:00.000Z' },
    ],
    researchSettings: { model: 'gpt-5-mini', maxOutputTokens: 24000, reasoningEffort: 'medium', budgetUsd: 0.5, maxAttempts: 3 },
    aiReview: { summary: 'Fictional review of the test portfolio.', weights: { MEBL: 20, HBL: 15, LUCK: 15 }, generatedAt: now.toISOString(), snapshot: '{}' },
  };
}

function finqalab(today: string, now: Date): Portfolio {
  const d = (n: number) => daysAgo(today, n);
  const fq = (ticker: string, kind: 'buy' | 'sell', days: number, shares: number, price: number, extra: Partial<Trade> = {}): Trade =>
    trade({ ticker, kind, date: d(days), shares, price, source: 'finqalab', externalId: `fq:${ticker}:${days}:${kind}`, ...extra });
  const trades: Trade[] = [
    fq('MEBL', 'buy', 260, 150, 290),
    fq('HBL', 'buy', 240, 200, 150),
    fq('OGDC', 'buy', 200, 400, 200),
    fq('PSO', 'buy', 180, 100, 380),
    fq('PSO', 'sell', 80, 100, 400, { taxWithheld: 600 }), // fully exited
    fq('EFERT', 'buy', 70, 100, 230),
    trade({ ticker: 'MEBL', kind: 'buy', date: d(25), shares: 20, price: 315 }), // manual alongside imports
  ];
  const tickers = ['MEBL', 'HBL', 'OGDC', 'PSO', 'EFERT'];
  const date = d(120);
  const shares = heldBefore(trades, 'OGDC', date);
  return {
    ...blankPortfolio(),
    companies: tickers.map((t, i) => company(t, [20, 20, 20, 0, 20][i], true, today)),
    trades,
    quotes: quotes(tickers, today, now),
    budgets: { [monthOf(today)]: 50000 },
    dividends: [{ id: nextId('d'), ticker: 'OGDC', date, source: 'manual', perShare: 4, grossAmount: r2(shares * 4), taxWithheld: r2(shares * 4 * 0.3), status: 'received', note: 'Non-filer rate.' }],
    taxProfile: { filerStatus: 'non-filer' },
  };
}

function savings(today: string, now: Date): Portfolio {
  const d = (n: number) => daysAgo(today, n);
  const month = (n: number) => monthOf(daysAgo(today, n * 30));

  const gold: MetalAsset = {
    id: 'gold-coins', kind: 'metal', name: 'Wedding gold', metal: 'gold', karat: 22, note: 'Fictional.',
    entries: [
      { id: 'g1', date: d(380), type: 'opening', grams: 23.3, pieces: 2, pieceGrams: 11.65, form: 'coin', amount: null, note: 'Inherited, cost unknown.' },
      { id: 'g2', date: d(250), type: 'buy', grams: 34.992, pieces: 3, pieceGrams: 11.664, form: 'coin', amount: 830000, note: '3 x 1 tola coins.' },
      { id: 'g3', date: d(90), type: 'sell', grams: 11.664, amount: 330000, note: 'Sold one tola.' },
      { id: 'g4', date: d(200), type: 'buy', grams: 5, form: 'bar', amount: 120000, note: 'Voided purchase.', voided: true },
    ],
  };
  const bar: MetalAsset = {
    id: 'gold-bar', kind: 'metal', name: '24k bar', metal: 'gold', karat: 24, note: '',
    entries: [{ id: 'gb1', date: d(150), type: 'buy', grams: 50, pieces: 1, pieceGrams: 50, form: 'bar', amount: 1380000, note: '50 g bar.' }],
  };
  const silver: MetalAsset = {
    id: 'silver', kind: 'metal', name: 'Silver coins', metal: 'silver', karat: 24, note: '',
    entries: [{ id: 's1', date: d(120), type: 'buy', grams: 233.28, form: 'coin', amount: 82000, note: '20 tola.' }],
  };

  const plan: PlanAsset = {
    id: 'plan-mbp', kind: 'plan', name: 'Mahana Bachat', provider: 'pak-qatar-mbp', subFund: 'balanced', note: 'Fictional.', assumedAnnualRate: 0.12,
    entries: [
      { id: 'pe1', date: d(200), type: 'contribution', amount: 50000, load: 500, note: 'First contribution.' },
      { id: 'pe2', date: d(150), type: 'contribution', amount: 5000, recurringId: 'rule-1', note: '' },
      { id: 'pe3', date: d(120), type: 'contribution', amount: 5000, recurringId: 'rule-1', note: '' },
      { id: 'pe4', date: d(30), type: 'redeem', amount: 8000, note: 'Partial redemption.' },
      { id: 'pe5', date: d(60), type: 'contribution', amount: 9999, note: 'Voided.', voided: true },
    ],
    valuations: [
      { id: 'pv1', date: d(100), value: 62000, note: 'Statement.' },
      { id: 'pv2', date: d(10), value: 63500, note: 'Statement.', voided: true },
    ],
    rules: [{ id: 'rule-1', dayOfMonth: 10, amount: 5000, from: month(5), skipped: [month(3)] }],
  };
  const closedPlan: PlanAsset = {
    id: 'plan-old', kind: 'plan', name: 'Old savings plan', provider: 'other', note: '', closed: true,
    entries: [
      { id: 'po1', date: d(400), type: 'contribution', amount: 100000, note: '' },
      { id: 'po2', date: d(40), type: 'redeem', amount: 118000, note: 'Closed out.' },
    ],
    valuations: [{ id: 'pov1', date: d(41), value: 118000, note: 'Final statement.' }],
    rules: [],
  };

  const [moneyMarket, equity, income] = TEST_FUNDS;
  const reinvest: FundAsset = {
    id: 'fund-mm', kind: 'fund', name: moneyMarket.fundName, mufapId: moneyMarket.mufapId, amc: moneyMarket.amc, fundName: moneyMarket.fundName, category: moneyMarket.category,
    note: '', payoutMode: 'reinvest',
    entries: [
      { id: 'fe1', date: d(300), type: 'opening', units: 500, amount: null, note: 'Cost unknown.' },
      { id: 'fe2', date: d(250), type: 'buy', units: 1000, amount: 100000, load: 1000, note: '' },
      { id: 'fe3', date: d(150), type: 'buy', units: 100, amount: 10000, recurringId: 'frule-1', note: '' },
      { id: 'fe4', date: d(60), type: 'reinvest', units: 12.5, amount: 1250, source: 'auto', estimated: true, autoBatch: 'seed-fund-batch', perUnit: 1.2, exNav: 100, taxWithheld: 150, note: '' },
      { id: 'fe5', date: d(30), type: 'redeem', units: 200, amount: 20000, note: '' },
    ],
    manualNavs: [{ id: 'fm1', date: d(2), nav: 101.9 }],
    rules: [{ id: 'frule-1', dayOfMonth: 5, amount: 10000, from: month(6), skipped: [month(5)] }],
  };
  const cash: FundAsset = {
    id: 'fund-eq', kind: 'fund', name: equity.fundName, mufapId: equity.mufapId, amc: equity.amc, fundName: equity.fundName, category: equity.category,
    note: '', payoutMode: 'cash', payoutTaxRate: 0.15,
    entries: [
      { id: 'fq1', date: d(200), type: 'buy', units: 400, amount: 50000, note: '' },
      { id: 'fq2', date: d(80), type: 'dividend', amount: 2000, taxWithheld: 300, note: 'Cash payout.' },
    ],
    manualNavs: [], rules: [],
  };
  const closedFund: FundAsset = {
    id: 'fund-inc', kind: 'fund', name: income.fundName, mufapId: income.mufapId, amc: income.amc, fundName: income.fundName, category: income.category, note: '', closed: true,
    entries: [
      { id: 'fi1', date: d(300), type: 'buy', units: 1000, amount: 54000, note: '' },
      { id: 'fi2', date: d(100), type: 'redeem', units: 1000, amount: 56000, note: 'Exited.' },
    ],
    manualNavs: [], rules: [],
  };

  void now;
  const dollars: CurrencyAsset = {
    id: 'usd-cash', kind: 'currency', name: 'Dollars at home', currency: 'USD', heldAt: 'cash', note: 'Fictional.',
    entries: [
      { id: 'fx1', date: d(300), type: 'opening', units: 200, pkr: null, note: 'Already owned, cost unknown.' },
      { id: 'fx2', date: d(180), type: 'buy', units: 500, pkr: 138500, note: 'Bought from an exchange company.' },
      { id: 'fx3', date: d(60), type: 'sell', units: 150, pkr: 42300, note: 'Sold some back.' },
      { id: 'fx4', date: d(40), type: 'buy', units: 100, pkr: 28000, note: 'Voided purchase.', voided: true },
    ],
  };
  const dirhams: CurrencyAsset = {
    id: 'aed-bank', kind: 'currency', name: 'Dirhams in the bank', currency: 'AED', heldAt: 'bank', note: '',
    entries: [{ id: 'fx5', date: d(100), type: 'buy', units: 1000, pkr: 76000, note: 'Fictional.' }],
  };
  return { ...blankPortfolio(), assets: [gold, bar, silver, plan, closedPlan, reinvest, cash, closedFund, dollars, dirhams] };
}

export function buildTestAccount(today: string, now: Date = new Date()): PortfolioAccount {
  seq = 0;
  return {
    kind: 'sipwise-portfolio-account',
    version: 1,
    portfolios: [
      { id: 'ahl-core', name: 'AHL Core', portfolio: ahlCore(today, now) },
      { id: 'finqalab', name: 'Finqalab', portfolio: finqalab(today, now) },
      { id: 'savings-gold', name: 'Savings & Gold', portfolio: savings(today, now) },
      { id: 'empty', name: 'Empty', portfolio: blankPortfolio(), locked: true },
    ],
  };
}

/** The same account as a plain backup file, restorable from Settings on the All portfolios view. */
export function buildTestBackup(today: string, now: Date = new Date()) {
  return { kind: 'sipwise-portfolio-account-backup', schemaVersion: 1, account: buildTestAccount(today, now) };
}
