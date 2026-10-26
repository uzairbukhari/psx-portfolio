import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDevice, cleanCountry } from '../lib/device-class.ts';
import { clsBucket, ledgerAgeBucket, portfoliosBucket, positionsBucket, timingBucket, validateEvent } from '../lib/analytics-events.ts';

const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

test('user agents become a coarse os, browser and form factor', () => {
  assert.deepEqual(classifyDevice(UA.winChrome, 'web'), { os: 'windows', browser: 'chrome', formFactor: 'desktop' });
  assert.deepEqual(classifyDevice(UA.winEdge, 'web'), { os: 'windows', browser: 'edge', formFactor: 'desktop' });
  assert.deepEqual(classifyDevice(UA.macSafari, 'web'), { os: 'macos', browser: 'safari', formFactor: 'desktop' });
  assert.deepEqual(classifyDevice(UA.iphone, 'web'), { os: 'ios', browser: 'safari', formFactor: 'phone' });
  assert.deepEqual(classifyDevice(UA.androidChrome, 'web'), { os: 'android', browser: 'chrome', formFactor: 'phone' });
  assert.deepEqual(classifyDevice(UA.androidTablet, 'web'), { os: 'android', browser: 'chrome', formFactor: 'tablet' });
  assert.deepEqual(classifyDevice(UA.samsung, 'web'), { os: 'android', browser: 'samsung', formFactor: 'phone' });
  assert.deepEqual(classifyDevice(UA.firefox, 'web'), { os: 'linux', browser: 'firefox', formFactor: 'desktop' });
  assert.deepEqual(classifyDevice(null, 'web'), { os: 'other', browser: 'other', formFactor: 'desktop' });
});

test('phone apps take the os from the platform', () => {
  assert.deepEqual(classifyDevice('okhttp/4.12.0', 'android'), { os: 'android', browser: 'app', formFactor: 'phone' });
  assert.deepEqual(classifyDevice('Sipwise/1 CFNetwork Darwin', 'ios'), { os: 'ios', browser: 'app', formFactor: 'phone' });
});

test('country keeps only real two-letter codes', () => {
  assert.equal(cleanCountry('PK'), 'PK');
  assert.equal(cleanCountry('XX'), null);
  assert.equal(cleanCountry('T1'), null);
  assert.equal(cleanCountry('pk'), null);
  assert.equal(cleanCountry('Karachi'), null);
  assert.equal(cleanCountry(undefined), null);
});

test('buckets never carry an exact count or duration', () => {
  assert.deepEqual([0, 3, 12, 40].map(positionsBucket), ['none', 'p1_5', 'p6_20', 'p21_plus']);
  assert.deepEqual([1, 2, 7].map(portfoliosBucket), ['one', 'two', 'three_plus']);
  assert.deepEqual([90, 600, 2500, 9000, 30_000].map(timingBucket), ['under_250ms', 'under_1s', 'under_3s', 'under_10s', 'over_10s']);
  assert.deepEqual([0.02, 0.2, 0.6].map(clsBucket), ['cls_low', 'cls_mid', 'cls_high']);
  assert.equal(ledgerAgeBucket(null, '2026-10-26'), 'empty');
  assert.equal(ledgerAgeBucket('2026-10-24', '2026-10-26'), 'week');
  assert.equal(ledgerAgeBucket('2026-01-01', '2026-10-26'), 'older');
  assert.ok(validateEvent({ event: 'account_snapshot', props: { positions: 'p6_20', portfolios: 'two', classes: 'multi', ledger_age: 'older' } }));
  assert.equal(validateEvent({ event: 'account_snapshot', props: { positions: '14' } }), null);
  assert.ok(validateEvent({ event: 'web_vital', props: { metric: 'lcp', rating: 'good', bucket: 'under_3s', screen: 'holdings' } }));
  assert.ok(validateEvent({ event: 'timing', props: { op: 'vault_unlock', bucket: 'under_1s' } }));
  assert.ok(validateEvent({ event: 'dialog_closed', props: { dialog: 'add_entry', outcome: 'cancel' } }));
});

import { accountSnapshot } from '../lib/analytics-snapshot.ts';
test('account snapshot is buckets only', () => {
  const portfolio = (trades, assets) => ({
    portfolio: { trades, assets, companies: trades.map((t) => ({ ticker: t.ticker, name: t.ticker })), dividends: [], quotes: {} },
  });
  const buy = (ticker, date) => ({ id: `${ticker}-${date}`, ticker, kind: 'buy', date, shares: 10, price: 100, fees: 0, month: date.slice(0, 7), note: '' });
  const snap = accountSnapshot({ portfolios: [portfolio([buy('MEBL', '2026-01-02'), buy('LUCK', '2026-03-01')], []), portfolio([], [{ kind: 'metal' }])] }, '2026-10-26');
  assert.deepEqual(snap, { positions: 'p1_5', portfolios: 'two', classes: 'multi', ledger_age: 'older' });
  assert.ok(validateEvent({ event: 'account_snapshot', props: snap }));
  assert.deepEqual(accountSnapshot({ portfolios: [portfolio([], [])] }, '2026-10-26'), { positions: 'none', portfolios: 'one', classes: 'none', ledger_age: 'empty' });
});
