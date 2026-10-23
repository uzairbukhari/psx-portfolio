import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFICIAL_NISAB,
  ZAKAT_RATE_SOLAR,
  addDays,
  allocatePayments,
  applySchool,
  closeYear,
  firstOfHijriMonth,
  lockDueYears,
  lockPending,
  fromHijri,
  newBook,
  openYear,
  paidSteps,
  recordTrail,
  toHijri,
  upcomingReminders,
  validateZakat,
  yearDue,
  yearStart,
  zakatBreakdown,
  zakatProgress,
} from '../lib/zakat.ts';
import { blankPortfolio } from '../lib/portfolio.ts';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today } from '../lib/portfolio.ts';

const rates = (silver = 9600, gold = 460000) => [
  { date: '2026-10-21', metal: 'silver', kind: 'local', pkrPerTola: silver, sourceUrl: '', fetchedAt: '' },
  { date: '2026-10-21', metal: 'gold', kind: 'local', pkrPerTola: gold, sourceUrl: '', fetchedAt: '' },
];
const bookWith = (items = [], extra = {}) => ({ ...newBook('2026-01-04'), items, ...extra });
const item = (id, kind, amount) => ({ id, kind, amount, asOf: '2026-10-01', note: '' });
const part = (portfolio = blankPortfolio()) => [{ id: 'p', name: 'Mine', portfolio }];
const pay = (id, date, amount, extra = {}) => ({ id, date, amount, kind: 'direct', note: '', ...extra });

test('Hijri conversion round-trips and matches known dates', () => {
  assert.deepEqual(toHijri('2026-01-04'), { year: 1447, month: 7, day: 15 });
  assert.equal(toHijri('2026-02-18').month, 9);
  assert.equal(toHijri('2026-02-18').day, 1);
  for (let d = '2024-01-01'; d < '2031-01-01'; d = addDays(d, 11)) assert.equal(fromHijri(toHijri(d)), d);
});

test('lunar years repeat on the same Hijri day, solar years on the same date', () => {
  const b = newBook('2026-01-04');
  assert.equal(yearStart(b.settings, 0), '2026-01-04');
  const next = toHijri(yearDue(b.settings, 0));
  assert.deepEqual([next.month, next.day], [7, 15]);
  assert.equal(next.year, 1448);
  const solar = { ...b.settings, year: 'solar' };
  assert.equal(yearDue(solar, 0), '2027-01-04');
  assert.equal(yearStart({ ...b.settings, dueShiftDays: 1 }, 1), addDays(fromHijri({ year: 1448, month: 7, day: 15 }), 1));
});

test('silver nisab at 52.5 tola, gold at 7.5 tola, official figure when no rate is loaded', () => {
  const b = bookWith([item('c', 'cash', 6_000_000)]);
  const z = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-10-22');
  assert.equal(z.nisab.value, 504_000);
  assert.equal(z.nisab.basis, 'silver');
  const gold = zakatBreakdown(part(), { ...b, settings: { ...b.settings, nisab: 'gold' } }, { metalRates: rates() }, '2026-10-22');
  assert.equal(gold.nisab.value, 3_450_000);
  const none = zakatBreakdown(part(), b, {}, '2026-10-22');
  assert.equal(none.nisab.value, OFFICIAL_NISAB.amount);
  assert.equal(none.nisab.basis, 'official');
});

test('2.5% on net wealth, nothing below the nisab, solar rate is higher', () => {
  const b = bookWith([item('c', 'cash', 1_000_000), item('b', 'bank', 1_000_000)]);
  const z = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-10-22');
  assert.equal(z.net, 2_000_000);
  assert.equal(z.zakat, 50_000);
  const solar = zakatBreakdown(part(), { ...b, settings: { ...b.settings, year: 'solar' } }, { metalRates: rates() }, '2026-10-22');
  assert.equal(solar.zakat, Math.round(2_000_000 * ZAKAT_RATE_SOLAR * 100) / 100);
  assert.ok(solar.zakat > z.zakat);
  const small = zakatBreakdown(part(), bookWith([item('c', 'cash', 400_000)]), { metalRates: rates() }, '2026-10-22');
  assert.equal(small.aboveNisab, false);
  assert.equal(small.zakat, 0);
});

test('debts deduct unless the school says not to; jewellery follows the school', () => {
  const b = bookWith([item('c', 'cash', 2_000_000), item('j', 'jewellery', 1_000_000), item('d', 'debt', 500_000)]);
  const hanafi = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-10-22');
  assert.equal(hanafi.net, 2_500_000);
  const shafii = zakatBreakdown(part(), { ...b, settings: applySchool(b.settings, 'shafii') }, { metalRates: rates() }, '2026-10-22');
  assert.equal(shafii.net, 2_000_000);
  assert.equal(applySchool(b.settings, 'maliki').debts, 'deduct');
  assert.equal(applySchool(b.settings, 'maliki').jewellery, 'exclude');
});

test('stocks count at full value, or 25% with the proxy, per company overrides win', () => {
  const account = buildTestAccount(today());
  const core = account.portfolios[0].portfolio;
  const parts = [{ id: 'core', name: 'Core', portfolio: core }];
  const base = { ...newBook('2026-01-04'), settings: { ...newBook('2026-01-04').settings, portfolioIds: ['core'] } };
  const full = zakatBreakdown(parts, base, {}, today());
  const proxy = zakatBreakdown(parts, { ...base, settings: { ...base.settings, shares: 'proxy25' } }, {}, today());
  const stocks = (z) => z.rows.find((r) => r.key === 'stocks');
  assert.ok(stocks(full).value > 0);
  assert.equal(stocks(full).counted, stocks(full).value);
  assert.ok(Math.abs(stocks(proxy).counted - stocks(full).value * 0.25) < 1);
  assert.ok(full.otherMethodZakat !== null);
  const excluded = zakatBreakdown(parts, { ...base, settings: { ...base.settings, overrides: Object.fromEntries(core.companies.map((c) => [c.ticker, 'exclude'])) } }, {}, today());
  assert.equal(excluded.rows.find((r) => r.key === 'stocks')?.counted ?? 0, 0);
});

test('unpriced holdings are listed as missing, never counted as zero silently', () => {
  const account = buildTestAccount(today());
  const core = JSON.parse(JSON.stringify(account.portfolios[0].portfolio));
  core.quotes = {};
  const z = zakatBreakdown([{ id: 'core', name: 'Core', portfolio: core }], newBook('2026-01-04'), {}, today());
  assert.ok(z.missing.some((m) => m.startsWith('No price for')));
});

test('payments count toward the year their date falls in; the surplus is extra', () => {
  const b = bookWith([item('c', 'cash', 2_000_000)], { payments: [pay('a', '2026-02-19', 11_250, { kind: 'bank' }), pay('b', '2026-06-01', 30_000), pay('v', '2026-07-01', 99_999, { voided: true })] });
  const z = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-10-22');
  const prog = zakatProgress(b, z, '2026-10-22');
  assert.equal(prog.estimate, 50_000);
  assert.equal(prog.paid, 41_250);
  assert.equal(prog.remaining, 8_750);
  assert.equal(prog.extra, 0);
  assert.equal(prog.percentPaid, 83);
  const over = zakatProgress({ ...b, payments: [...b.payments, pay('x', '2026-09-01', 20_000)] }, z, '2026-10-22');
  assert.equal(over.remaining, 0);
  assert.equal(over.extra, 11_250);
  assert.deepEqual(paidSteps(b).map((s) => s[1]), [0, 11_250, 41_250]);
});

test('closing a year freezes the amount and starts the next; late payments clear the closed year first', () => {
  const b = bookWith([item('c', 'cash', 2_000_000)], { payments: [pay('a', '2026-06-01', 30_000)] });
  const z = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-12-24');
  const closed = closeYear(b, z, '2026-12-24');
  assert.equal(closed.years.length, 1);
  assert.equal(closed.years[0].amountDue, 50_000);
  assert.equal(closed.years[0].snapshot.zakat, 50_000);
  const next = openYear(closed);
  assert.equal(next.index, 1);
  assert.equal(next.start, closed.years[0].due);
  const withLate = { ...closed, payments: [...closed.payments, pay('late', '2026-12-30', 25_000)] };
  const alloc = allocatePayments(withLate);
  assert.equal(alloc.paid[0], 30_000 + 20_000);
  assert.equal(alloc.openPaid, 5_000);
  const prog = zakatProgress(withLate, z, '2026-12-31');
  assert.equal(prog.past[0].remaining, 0);
  assert.equal(prog.paid, 5_000);
});

test('carrying the surplus is opt-in', () => {
  const b = bookWith([item('c', 'cash', 2_000_000)], { payments: [pay('a', '2026-06-01', 80_000)] });
  const z = zakatBreakdown(part(), b, { metalRates: rates() }, '2026-12-24');
  assert.equal(closeYear(b, z, '2026-12-24').carriedIn, undefined);
  assert.equal(closeYear(b, z, '2026-12-24', true).carriedIn, 30_000);
});

test('the weekly trail records at most once a week inside the year', () => {
  let b = bookWith([]);
  b = recordTrail(b, '2026-02-01', 1000);
  b = recordTrail(b, '2026-02-04', 2000);
  b = recordTrail(b, '2026-02-09', 3000);
  assert.deepEqual(b.trail.map((t) => t.zakat), [1000, 3000]);
  assert.equal(recordTrail(b, '2025-12-01', 5).trail.length, 2);
});

test('reminders: a week before the due date, CZ-50 thirty days before 1 Ramadan, and 1 Ramadan', () => {
  const b = bookWith([]);
  const list = upcomingReminders(b, '2026-10-22');
  const due = list.find((r) => r.id === 'due');
  assert.equal(due.date, addDays(yearDue(b.settings, 0), -7));
  const ramadan = firstOfHijriMonth(1448, 9);
  assert.equal(list.find((r) => r.id === 'ramadan').date, ramadan);
  assert.equal(list.find((r) => r.id === 'cz50').date, addDays(ramadan, -30));
  assert.equal(upcomingReminders({ ...b, settings: { ...b.settings, remind: { due: false, cz50: false, ramadan: false } } }, '2026-10-22').length, 0);
});

test('validation accepts the seed and rejects bad records', () => {
  const book = buildTestAccount(today()).portfolios[0].portfolio.zakat;
  assert.doesNotThrow(() => validateZakat(JSON.parse(JSON.stringify(book))));
  const bad = (mut) => {
    const x = JSON.parse(JSON.stringify(book));
    mut(x);
    assert.throws(() => validateZakat(x));
  };
  bad((x) => (x.settings.startDate = 'yesterday'));
  bad((x) => (x.payments[0].amount = -5));
  bad((x) => (x.payments[1].id = x.payments[0].id));
  bad((x) => (x.items[0].kind = 'gold'));
  bad((x) => (x.settings.nisab = 'copper'));
});

test('a year is fixed from its zakat day: later prices never change it, and several missed years are fixed one by one', () => {
  const account = buildTestAccount(today());
  const core = account.portfolios[0].portfolio;
  const parts = [{ id: 'core', name: 'Core', portfolio: core }];
  const book = { ...newBook('2025-01-04'), items: [item('c', 'cash', 900_000)], settings: { ...newBook('2025-01-04').settings, portfolioIds: ['core'] } };
  const due = openYear(book).due;
  const sec = (date) => Date.parse(`${date}T12:00:00Z`) / 1000;
  const closesFor = (laterPrice) =>
    Object.fromEntries(core.companies.map((c) => [c.ticker, [[sec(addDays(due, -3)), 10], [sec(addDays(due, 5)), laterPrice]]]));
  const onDay = zakatBreakdown(parts, book, { closes: closesFor(10) }, due);
  const later = zakatBreakdown(parts, book, { closes: closesFor(5000) }, due);
  assert.equal(onDay.valuedOnDay, true);
  assert.equal(onDay.zakat, later.zakat);
  assert.equal(lockPending(book, due), false);
  assert.equal(lockPending(book, addDays(due, 1)), true);

  const fixed = lockDueYears(book, parts, { closes: closesFor(5000) }, addDays(due, 1));
  assert.equal(fixed.years.length, 1);
  assert.equal(fixed.years[0].amountDue, onDay.zakat);
  assert.equal(fixed.years[0].snapshot.valuedOnDay, true);
  assert.equal(lockDueYears(fixed, parts, {}, addDays(due, 1)).years.length, 1);

  const twice = lockDueYears(book, parts, { closes: closesFor(10) }, addDays(yearDue(book.settings, 1), 2));
  assert.equal(twice.years.length, 2);
  // Without closes the snapshot says the latest prices were used.
  assert.equal(lockDueYears(book, parts, {}, addDays(due, 1)).years[0].snapshot.valuedOnDay, undefined);
});
