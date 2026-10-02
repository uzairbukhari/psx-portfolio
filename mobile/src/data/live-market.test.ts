import test from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, emptyLive, liveRows, parseLiveEvent, readLiveStream, reduceLive, retryDelayMs, shouldStream, StreamRejected } from './live-market.ts';

const quote = (ticker: string, price: number, at: string, extra: Record<string, unknown> = {}) =>
  `event: quote\ndata: ${JSON.stringify({ ticker, price, high: null, low: null, volume: 10, change: 1, changePercent: 0.5, sourceTimestamp: null, providerMarketState: 'OPN', receivedAt: at, ...extra })}\n\n`;

test('parser reads whole events and ignores keep-alive comments', () => {
  const p = createSseParser();
  const out = p.push(`event: status\ndata: {"connected":true,"provider":"pyPSX"}\n\n: keep-alive\n\n${quote('MEBL', 250, '2026-10-01T07:00:00Z')}`);
  assert.equal(out.length, 2);
  assert.equal(out[0].event, 'status');
  assert.equal(out[1].event, 'quote');
});

test('parser handles events split across chunks, CRLF split in two, multi-line data and a BOM', () => {
  const p = createSseParser();
  assert.deepEqual(p.push('﻿event: quo'), []);
  assert.deepEqual(p.push('te\r'), []);
  assert.deepEqual(p.push('\ndata: {"a":'), []);
  assert.deepEqual(p.push('1}\r\n\r'), []);
  assert.deepEqual(p.push('\n'), [{ event: 'quote', data: '{"a":1}' }]);
  assert.deepEqual(p.push('data: one\ndata: two\n\n'), [{ event: 'message', data: 'one\ntwo' }]);
  assert.deepEqual(p.push('data:no-space\n\n'), [{ event: 'message', data: 'no-space' }]);
});

test('typed events are validated and bad ones dropped', () => {
  assert.deepEqual(parseLiveEvent({ event: 'status', data: '{"connected":false}' }), { kind: 'status', connected: false });
  assert.equal(parseLiveEvent({ event: 'status', data: '{"connected":"yes"}' }), null);
  assert.equal(parseLiveEvent({ event: 'quote', data: '{"ticker":"mebl","price":5}' }), null);
  assert.equal(parseLiveEvent({ event: 'quote', data: '{"ticker":"MEBL","price":0}' }), null);
  assert.equal(parseLiveEvent({ event: 'quote', data: 'not json' }), null);
  assert.equal(parseLiveEvent({ event: 'other', data: '{}' }), null);
  const ok = parseLiveEvent({ event: 'quote', data: '{"ticker":"MEBL","price":251.5,"change":"x","receivedAt":"2026-10-01T07:00:00Z"}' });
  assert.equal(ok?.kind, 'quote');
  if (ok?.kind === 'quote') {
    assert.equal(ok.quote.price, 251.5);
    assert.equal(ok.quote.change, null);
  }
});

test('reducer keeps the latest quote per ticker, newest first, and follows the provider session', () => {
  let s = emptyLive;
  const q = (t: string, price: number, at: string, state = 'OPN') => {
    const e = parseLiveEvent({ event: 'quote', data: JSON.stringify({ ticker: t, price, providerMarketState: state, receivedAt: at }) });
    assert.ok(e);
    return e;
  };
  s = reduceLive(s, q('AAA', 10, '2026-10-01T07:00:00Z'));
  s = reduceLive(s, q('BBB', 20, '2026-10-01T07:00:05Z'));
  s = reduceLive(s, q('AAA', 11, '2026-10-01T07:00:10Z'));
  assert.equal(s.connected, true);
  assert.equal(s.session, 'open');
  assert.deepEqual(liveRows(s).map((r) => [r.ticker, r.price]), [['AAA', 11], ['BBB', 20]]);
  assert.equal(liveRows(s, 1).length, 1);
  s = reduceLive(s, q('AAA', 11, '2026-10-01T10:30:00Z', 'CLS'));
  assert.equal(s.session, 'closed');
  s = reduceLive(s, { kind: 'status', connected: false });
  assert.equal(s.connected, false);
  assert.equal(Object.keys(s.quotes).length, 2);
});

test('streams only when focused, in the foreground, market open and the feed is available', () => {
  const on = { focused: true, appActive: true, marketOpen: true, available: true };
  assert.equal(shouldStream(on), true);
  for (const k of Object.keys(on)) assert.equal(shouldStream({ ...on, [k]: false }), false, k);
  assert.deepEqual([0, 1, 2].map(retryDelayMs), [5000, 15000, 45000]);
});

function fakeFetch(chunks: string[], status = 200, hang = false) {
  const enc = new TextEncoder();
  return async (_url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    calls.push(init.headers);
    let i = 0;
    const reader = {
      read: async () => {
        if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
        if (hang) await new Promise((resolve) => init.signal.addEventListener('abort', () => resolve(null)));
        return { done: true };
      },
      cancel: async () => {},
    };
    return { ok: status < 400, status, body: { getReader: () => reader } };
  };
}
const calls: Record<string, string>[] = [];

test('read loop decodes split multi-byte chunks, sends the bearer token and reports events', async () => {
  const events: unknown[] = [];
  const full = quote('MEBL', 250, '2026-10-01T07:00:00Z', { note: 'rupee ₨' });
  const enc = new TextEncoder().encode(full);
  const mid = enc.indexOf(0xe2) + 1; // split inside the 3-byte rupee sign
  const bytes = [enc.slice(0, mid), enc.slice(mid)];
  const fetcher = async (_u: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    calls.push(init.headers);
    let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < 2 ? { done: false, value: bytes[i++] } : { done: true }), cancel: async () => {} }) } };
  };
  await readLiveStream({ fetcher, url: 'https://x/api/market-stream', token: 'tok', signal: new AbortController().signal, onEvent: (e) => events.push(e) });
  assert.equal(events.length, 1);
  assert.equal(calls.at(-1)?.Authorization, 'Bearer tok');
  assert.equal(calls.at(-1)?.Accept, 'text/event-stream');
});

test('read loop throws StreamRejected on a non-2xx answer and stops when aborted', async () => {
  await assert.rejects(
    readLiveStream({ fetcher: fakeFetch([], 403), url: 'u', token: null, signal: new AbortController().signal, onEvent: () => {} }),
    (e) => e instanceof StreamRejected && e.status === 403,
  );
  const ctl = new AbortController();
  const seen: unknown[] = [];
  const run = readLiveStream({ fetcher: fakeFetch([quote('AAA', 1, '2026-10-01T07:00:00Z')], 200, true), url: 'u', token: null, signal: ctl.signal, onEvent: (e) => seen.push(e) });
  setTimeout(() => ctl.abort(), 10);
  await run;
  assert.equal(seen.length, 1);
});
