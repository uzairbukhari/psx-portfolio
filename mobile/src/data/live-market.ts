// Live market stream, pure parts: the server-sent-events parser for /api/market-stream, the typed events, a small
// reducer for the card, and the read loop (fetch is injected so it can be tested without a network or React Native).
// The stream carries quotes for the companies in Monthly Picks / targets, not the KSE-100 index, so the index card
// keeps its own polling.
import type { PypsxLiveQuote } from '../../../lib/pypsx-market.ts';

export type SseEvent = { event: string; data: string };

/** Incremental parser: feed text chunks as they arrive, get the events completed by each chunk. */
export function createSseParser() {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let first = true;
  return {
    push(chunk: string): SseEvent[] {
      buffer += first ? chunk.replace(/^﻿/, '') : chunk;
      first = false;
      // A trailing CR may be the first half of CRLF; wait for the next chunk to decide.
      const hold = buffer.endsWith('\r') ? '\r' : '';
      const body = (hold ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');
      const lines = body.split('\n');
      buffer = (lines.pop() ?? '') + hold;
      const out: SseEvent[] = [];
      for (const line of lines) {
        if (line === '') {
          if (data.length) out.push({ event: event || 'message', data: data.join('\n') });
          event = '';
          data = [];
        } else if (line.startsWith(':')) {
          // comment / keep-alive
        } else {
          const at = line.indexOf(':');
          const field = at < 0 ? line : line.slice(0, at);
          const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
      return out;
    },
  };
}

export type LiveEvent = { kind: 'status'; connected: boolean } | { kind: 'quote'; quote: PypsxLiveQuote };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: unknown) => (isNumber(v) ? v : null);

/** Validates one SSE event from the market stream; anything unexpected is dropped (null). */
export function parseLiveEvent(e: SseEvent): LiveEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(e.data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (e.event === 'status') return typeof v.connected === 'boolean' ? { kind: 'status', connected: v.connected } : null;
  if (e.event === 'quote') {
    if (typeof v.ticker !== 'string' || !/^[A-Z0-9]{2,12}$/.test(v.ticker) || !isNumber(v.price) || v.price <= 0) return null;
    return {
      kind: 'quote',
      quote: {
        ticker: v.ticker,
        price: v.price,
        high: orNull(v.high),
        low: orNull(v.low),
        volume: orNull(v.volume),
        change: orNull(v.change),
        changePercent: orNull(v.changePercent),
        sourceTimestamp: typeof v.sourceTimestamp === 'string' ? v.sourceTimestamp : null,
        providerMarketState: typeof v.providerMarketState === 'string' ? v.providerMarketState : null,
        receivedAt: typeof v.receivedAt === 'string' ? v.receivedAt : new Date(0).toISOString(),
      },
    };
  }
  return null;
}

export type LiveState = {
  connected: boolean;
  quotes: Record<string, PypsxLiveQuote>;
  /** The provider's own session verdict from the latest quote: open, closed, or unknown. */
  session: 'open' | 'closed' | null;
  receivedAt: string | null;
};

export const emptyLive: LiveState = { connected: false, quotes: {}, session: null, receivedAt: null };

export function reduceLive(state: LiveState, event: LiveEvent): LiveState {
  if (event.kind === 'status') return event.connected ? { ...state, connected: true } : { ...state, connected: false };
  const q = event.quote;
  const session = q.providerMarketState === 'OPN' ? 'open' : q.providerMarketState === 'CLS' || q.providerMarketState === 'SUS' ? 'closed' : state.session;
  return { connected: true, quotes: { ...state.quotes, [q.ticker]: q }, session, receivedAt: q.receivedAt };
}

/** Most recently updated quotes first. */
export function liveRows(state: LiveState, limit = 4): PypsxLiveQuote[] {
  return Object.values(state.quotes)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : a.ticker.localeCompare(b.ticker)))
    .slice(0, limit);
}

/** Stream only while the screen is focused, the app is in the foreground, PSX is open and the account has the feed. */
export const shouldStream = (o: { focused: boolean; appActive: boolean; marketOpen: boolean; available: boolean }) =>
  o.focused && o.appActive && o.marketOpen && o.available;

export const MAX_STREAM_RETRIES = 3;
/** Wait before reconnect attempt `attempt` (0-based): 5 s, 15 s, 45 s. */
export const retryDelayMs = (attempt: number) => 5_000 * 3 ** attempt;

export class StreamRejected extends Error {
  status: number;
  constructor(status: number) {
    super(`Live feed unavailable (${status}).`);
    this.name = 'StreamRejected';
    this.status = status;
  }
}

type StreamResponse = { ok: boolean; status: number; body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null };

/**
 * Opens the stream and calls `onEvent` for each valid event until it ends or `signal` aborts. Resolves when the
 * server closes the stream; throws StreamRejected for a non-2xx answer and rethrows network errors, so the caller
 * can fall back to polling.
 */
export async function readLiveStream(o: {
  fetcher: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<StreamResponse>;
  url: string;
  token: string | null;
  signal: AbortSignal;
  onEvent: (e: LiveEvent) => void;
  decoder?: { decode(input?: Uint8Array, options?: { stream?: boolean }): string };
}): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const response = await o.fetcher(o.url, { headers, signal: o.signal });
  if (!response.ok) throw new StreamRejected(response.status);
  if (!response.body) throw new StreamRejected(response.status || 0);
  const reader = response.body.getReader();
  const decoder = o.decoder ?? new TextDecoder();
  const parser = createSseParser();
  const stop = () => void reader.cancel().catch(() => {});
  o.signal.addEventListener('abort', stop);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;
      for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
        const parsed = parseLiveEvent(raw);
        if (parsed) o.onEvent(parsed);
      }
    }
  } finally {
    o.signal.removeEventListener('abort', stop);
  }
}
