import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePypsxIntraday, parsePypsxMessage } from '../lib/pypsx-market.ts';

test('pyPSX intraday parser returns the latest full session and compares it with the prior close', () => {
  const result = parsePypsxIntraday(
    {
      data: [
        ['2026-09-24T15:29:00+05:00', 100, 101, 99, 100, 1000],
        ['2026-09-25T09:32:00+05:00', 101, 103, 100, 102, 200],
        ['2026-09-25T12:00:00+05:00', 102, 105, 101, 104, 300],
        ['2026-09-25T15:29:00+05:00', 104, 106, 103, 105, 400],
      ],
    },
    'TEST',
  );
  assert.equal(result?.price, 105);
  assert.equal(result?.previousClose, 100);
  assert.equal(result?.change, 5);
  assert.equal(result?.changePercent, 5);
  assert.equal(result?.high, 106);
  assert.equal(result?.low, 100);
  assert.equal(result?.points.length, 3);
  assert.equal(result?.sourceTimestamp, '2026-09-25T10:29:00.000Z');
});

test('pyPSX intraday parser accepts object ticks and rejects malformed data', () => {
  const result = parsePypsxIntraday(
    { results: { MARI: [{ datetime: '2026-09-25T10:00:00+05:00', price: '650.5' }] } },
    'MARI',
  );
  assert.equal(result?.price, 650.5);
  assert.equal(result?.high, 650.5);
  assert.equal(result?.previousClose, null);
  assert.equal(
    parsePypsxIntraday(
      { results: [{ symbol: 'MARI', candles: [['2026-09-25T10:01:00+05:00', 651, 652, 650, 651.5, 20]] }] },
      'MARI',
    )?.price,
    651.5,
  );
  assert.equal(parsePypsxIntraday({ data: [{ time: 'bad', close: 1 }] }, 'MARI'), null);
});

test('pyPSX full snapshots expose only allowed shortlist symbols', () => {
  const result = parsePypsxMessage(
    JSON.stringify({
      type: 'market_prices',
      prices: { MARI: 650.5, FFC: 531.2, OGDC: 315.1 },
    }),
    new Set(['FFC', 'MARI']),
    '2026-09-25T05:00:00.000Z',
  );
  assert.deepEqual(result.updates.map((quote) => quote.ticker), ['MARI', 'FFC']);
  assert.equal(result.updates[0].receivedAt, '2026-09-25T05:00:00.000Z');
});

test('pyPSX tick messages preserve provider time and performance fields', () => {
  const result = parsePypsxMessage(
    JSON.stringify({
      type: 'market_ticks',
      data: {
        symbol: 'MARI',
        last: 652.1,
        high: 655,
        low: 639,
        volume: 800000,
        change: 11.67,
        change_percent: 1.82,
        market_state: 'OPN',
        timestamp: '2026-09-25T10:31:12+05:00',
      },
    }),
    new Set(['MARI']),
  );
  assert.deepEqual(result.updates[0], {
    ticker: 'MARI',
    price: 652.1,
    high: 655,
    low: 639,
    volume: 800000,
    change: 11.67,
    changePercent: 1.82,
    sourceTimestamp: '2026-09-25T10:31:12+05:00',
    providerMarketState: 'OPN',
    receivedAt: result.updates[0].receivedAt,
  });
});

test('pyPSX parser handles pings and ignores malformed or unauthorized ticks', () => {
  assert.deepEqual(
    parsePypsxMessage(JSON.stringify({ type: 'ping', timestamp: 123 }), new Set()),
    { updates: [], pongTimestamp: 123 },
  );
  assert.deepEqual(
    parsePypsxMessage(
      JSON.stringify({ type: 'market_ticks', data: { symbol: 'OGDC', last: 'bad' } }),
      new Set(['OGDC']),
    ).updates,
    [],
  );
  assert.deepEqual(
    parsePypsxMessage(
      JSON.stringify({ type: 'market_ticks', data: { symbol: 'OGDC', last: 315 } }),
      new Set(['MARI']),
    ).updates,
    [],
  );
});
