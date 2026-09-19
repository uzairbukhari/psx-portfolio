import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioReport } from '../lib/portfolio-reports.ts';

const portfolio = () => ({
  companies: [
    {
      ticker: 'AAA',
      name: 'Alpha Bank',
      sector: 'Bank',
      target: 40,
      approved: true,
      screenDate: '2026-06-05',
      note: '',
    },
    {
      ticker: 'BBB',
      name: 'Beta Foods',
      sector: 'Foods',
      target: 60,
      approved: true,
      screenDate: '2026-06-05',
      note: '',
    },
    {
      ticker: 'CCC',
      name: 'Cashless Cement',
      sector: 'Cement',
      target: 0,
      approved: false,
      screenDate: '',
      note: '',
    },
  ],
  trades: [
    {
      id: 'opening-a',
      ticker: 'AAA',
      kind: 'opening',
      date: '2026-01-01',
      shares: 10,
      price: null,
      fees: 0,
      month: '',
      note: '',
    },
    {
      id: 'buy-b',
      ticker: 'BBB',
      kind: 'buy',
      date: '2026-02-10',
      shares: 5,
      price: 20,
      fees: 5,
      month: '2026-02',
      note: '',
    },
    {
      id: 'voided-buy',
      ticker: 'AAA',
      kind: 'buy',
      date: '2026-02-11',
      shares: 3,
      price: 10,
      fees: 1,
      month: '2026-02',
      note: '',
      voided: true,
    },
    {
      id: 'sale-b',
      ticker: 'BBB',
      kind: 'sell',
      date: '2026-03-10',
      shares: 1,
      price: 25,
      fees: 2,
      month: '',
      note: '',
    },
  ],
  quotes: {
    AAA: {
      price: 30,
      date: '2026-09-15',
      asOf: '2026-09-15',
      source: 'https://dps.psx.com.pk/company/AAA',
      fetchedAt: '2026-09-15T12:00:00Z',
    },
    BBB: {
      price: 25,
      date: '2026-09-15',
      asOf: '2026-09-15',
      source: 'https://dps.psx.com.pk/company/BBB',
      fetchedAt: '2026-09-15T12:00:00Z',
    },
  },
  budgets: {},
});

test('ranks company allocation and calculates priced weights', () => {
  const report = portfolioReport(portfolio());
  assert.deepEqual(
    report.companyAllocation.map(({ ticker, value, weight }) => ({
      ticker,
      value,
      weight,
    })),
    [
      { ticker: 'AAA', value: 300, weight: 75 },
      { ticker: 'BBB', value: 100, weight: 25 },
    ],
  );
});

test('groups current value by sector and calculates concentration', () => {
  const report = portfolioReport(portfolio());
  assert.deepEqual(report.sectorAllocation, [
    { sector: 'Bank', value: 300, weight: 75 },
    { sector: 'Foods', value: 100, weight: 25 },
  ]);
  assert.equal(report.summary.largestHolding?.ticker, 'AAA');
  assert.equal(report.summary.largestHolding?.weight, 75);
  assert.equal(report.summary.topThreeWeight, 100);
  assert.equal(report.summary.largestSector?.sector, 'Bank');
});

test('compares actual and target weights when every held company is priced', () => {
  const report = portfolioReport(portfolio());
  assert.deepEqual(report.targetComparison, [
    { ticker: 'AAA', actual: 75, target: 40 },
    { ticker: 'BBB', actual: 25, target: 60 },
  ]);
});

test('aggregates buy cash including fees and excludes openings sales and voids', () => {
  const report = portfolioReport(portfolio());
  assert.deepEqual(report.monthlyActivity, [
    { month: '2026-02', invested: 105, cumulative: 105 },
  ]);
});

test('gain/loss performance excludes holdings with unknown cost basis', () => {
  const report = portfolioReport(portfolio());
  assert.deepEqual(report.performance, [
    {
      ticker: 'BBB',
      name: 'Beta Foods',
      cost: 84,
      value: 100,
      gain: 16,
      gainPercent: 19.05,
    },
  ]);
});

test('monthly activity carries a running cumulative total across months', () => {
  const p = {
    companies: [
      {
        ticker: 'X',
        name: 'Xylo Corp',
        sector: 'Tech',
        target: 50,
        approved: true,
        screenDate: '',
        note: '',
      },
      {
        ticker: 'Y',
        name: 'Yara Mills',
        sector: 'Textile',
        target: 50,
        approved: true,
        screenDate: '',
        note: '',
      },
    ],
    trades: [
      {
        id: 'x1',
        ticker: 'X',
        kind: 'buy',
        date: '2026-01-15',
        shares: 10,
        price: 10,
        fees: 0,
        month: '2026-01',
        note: '',
      },
      {
        id: 'y1',
        ticker: 'Y',
        kind: 'buy',
        date: '2026-01-20',
        shares: 5,
        price: 20,
        fees: 0,
        month: '2026-01',
        note: '',
      },
      {
        id: 'x2',
        ticker: 'X',
        kind: 'buy',
        date: '2026-02-05',
        shares: 5,
        price: 12,
        fees: 0,
        month: '2026-02',
        note: '',
      },
    ],
    quotes: {
      X: {
        price: 15,
        date: '2026-09-15',
        asOf: '2026-09-15',
        source: 'https://dps.psx.com.pk/company/X',
        fetchedAt: '2026-09-15T12:00:00Z',
      },
      Y: {
        price: 18,
        date: '2026-09-15',
        asOf: '2026-09-15',
        source: 'https://dps.psx.com.pk/company/Y',
        fetchedAt: '2026-09-15T12:00:00Z',
      },
    },
    budgets: {},
  };
  const report = portfolioReport(p);
  assert.deepEqual(report.monthlyActivity, [
    { month: '2026-01', invested: 200, cumulative: 200 },
    { month: '2026-02', invested: 60, cumulative: 260 },
  ]);
  assert.deepEqual(report.performance, [
    { ticker: 'X', name: 'Xylo Corp', cost: 160, value: 225, gain: 65, gainPercent: 40.63 },
    { ticker: 'Y', name: 'Yara Mills', cost: 100, value: 90, gain: -10, gainPercent: -10 },
  ]);
  assert.equal(report.summary.totalGain, 55);
  assert.equal(report.summary.totalGainPercent, 21.15);
});

test('realized sales report the sell trade gain, with null tax when no filer status is set', () => {
  const report = portfolioReport(portfolio());
  assert.equal(report.realized.sales.length, 1);
  assert.equal(report.realized.sales[0].realizedGain, 2);
  assert.equal(report.realized.totalRealizedGain, 2);
  assert.equal(report.realized.totalCapitalGainsTax, null);
  assert.equal(report.realized.netRealizedReturn, null);
  assert.equal(report.summary.grandTotalReturn, null);
});

test('grand total return combines unrealized gain with net-of-tax realized gain once filer status is set', () => {
  const p = portfolio();
  p.taxProfile = { filerStatus: 'filer' };
  const report = portfolioReport(p);
  assert.equal(report.realized.totalCapitalGainsTax, 0.3);
  assert.equal(report.realized.netRealizedReturn, 1.7);
  assert.equal(report.summary.totalGain, 16);
  assert.equal(report.summary.grandTotalReturn, 17.7);
});

test('reports incomplete quote coverage without presenting actual target weights', () => {
  const p = portfolio();
  delete p.quotes.BBB;
  const report = portfolioReport(p);
  assert.deepEqual(report.summary.quoteCoverage, {
    priced: 1,
    held: 2,
    percentage: 50,
  });
  assert.deepEqual(report.targetComparison, [
    { ticker: 'AAA', actual: null, target: 40 },
    { ticker: 'BBB', actual: null, target: 60 },
  ]);
  assert.deepEqual(
    report.companyAllocation.map((item) => item.ticker),
    ['AAA'],
  );
});
