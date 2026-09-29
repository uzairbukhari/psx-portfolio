export interface PypsxLiveQuote {
  ticker: string;
  price: number;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  sourceTimestamp: string | null;
  providerMarketState: string | null;
  receivedAt: string;
}

export interface PypsxIntradaySnapshot {
  ticker: string;
  price: number;
  high: number;
  low: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceTimestamp: string;
  points: { time: number; value: number }[];
}

const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function candle(value: unknown): Candle | null {
  if (Array.isArray(value)) {
    const time = timestamp(value[0]);
    const open = finite(value[1]);
    const high = finite(value[2]);
    const low = finite(value[3]);
    const close = finite(value[4] ?? value[1]);
    return time !== null && open !== null && high !== null && low !== null && close !== null
      ? { time, open, high, low, close }
      : null;
  }
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const time = timestamp(item.timestamp ?? item.datetime ?? item.time ?? item.date);
  const close = finite(item.close ?? item.price ?? item.last ?? item.PRICE);
  const open = finite(item.open ?? item.OPEN ?? close);
  const high = finite(item.high ?? item.HIGH ?? close);
  const low = finite(item.low ?? item.LOW ?? close);
  return time !== null && open !== null && high !== null && low !== null && close !== null
    ? { time, open, high, low, close }
    : null;
}

function rowsFromIntradayBody(body: unknown, ticker: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  for (const candidate of [record.candles, record.data, record.results, record.items]) {
    if (Array.isArray(candidate)) {
      if (candidate.length === 1 && candidate[0] && typeof candidate[0] === 'object') {
        const first = candidate[0] as Record<string, unknown>;
        if (Array.isArray(first.candles)) return first.candles;
        if (Array.isArray(first.data)) return first.data;
      }
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested[ticker])) return nested[ticker] as unknown[];
      if (Array.isArray(nested.candles)) return nested.candles as unknown[];
      if (Array.isArray(nested.data)) return nested.data as unknown[];
    }
  }
  return [];
}

const karachiDate = (time: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time));

export function parsePypsxIntraday(
  body: unknown,
  ticker: string,
  limit = 90,
): PypsxIntradaySnapshot | null {
  const candles = rowsFromIntradayBody(body, ticker)
    .map(candle)
    .filter((item): item is Candle => item !== null)
    .sort((a, b) => a.time - b.time);
  if (!candles.length) return null;
  const sessionDate = karachiDate(candles.at(-1)!.time);
  const session = candles.filter((item) => karachiDate(item.time) === sessionDate);
  const previous = candles.filter((item) => karachiDate(item.time) < sessionDate);
  if (!session.length) return null;
  const latest = session.at(-1)!;
  const previousClose = previous.at(-1)?.close ?? null;
  const change = previousClose === null ? null : latest.close - previousClose;
  const step = session.length > limit ? (session.length - 1) / (limit - 1) : 1;
  const selected = session.length > limit
    ? Array.from({ length: limit }, (_, index) => session[Math.round(index * step)])
    : session;
  return {
    ticker,
    price: latest.close,
    high: Math.max(...session.map((item) => item.high)),
    low: Math.min(...session.map((item) => item.low)),
    previousClose,
    change,
    changePercent: previousClose ? (change! / previousClose) * 100 : null,
    sourceTimestamp: new Date(latest.time).toISOString(),
    points: selected.map((item) => ({ time: item.time, value: item.close })),
  };
}

export function parsePypsxMessage(
  raw: string,
  allowed: Set<string>,
  receivedAt = new Date().toISOString(),
): { updates: PypsxLiveQuote[]; pongTimestamp?: unknown } {
  const message = JSON.parse(raw) as Record<string, unknown>;
  if (message.type === 'ping')
    return { updates: [], pongTimestamp: message.timestamp };

  if (message.type === 'market_prices' || message.type === 'hb') {
    const prices =
      message.prices && typeof message.prices === 'object'
        ? (message.prices as Record<string, unknown>)
        : {};
    return {
      updates: Object.entries(prices).flatMap(([ticker, value]) => {
        const price = finite(value);
        return allowed.has(ticker) && price !== null
          ? [{
              ticker,
              price,
              high: null,
              low: null,
              volume: null,
              change: null,
              changePercent: null,
              sourceTimestamp: null,
              providerMarketState: null,
              receivedAt,
            }]
          : [];
      }),
    };
  }

  if (message.type !== 'market_ticks') return { updates: [] };
  const payload = message.ticks ?? message.data ?? message.tick ?? message;
  const ticks = Array.isArray(payload) ? payload : [payload];
  return {
    updates: ticks.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const tick = value as Record<string, unknown>;
      const rawTicker = tick.symbol ?? tick.ticker;
      if (typeof rawTicker !== 'string') return [];
      const ticker = rawTicker.toUpperCase();
      const price = finite(tick.last ?? tick.price ?? tick.p);
      if (!allowed.has(ticker) || price === null) return [];
      return [{
        ticker,
        price,
        high: finite(tick.high ?? tick.h),
        low: finite(tick.low ?? tick.l),
        volume: finite(tick.volume ?? tick.v),
        change: finite(tick.change),
        changePercent: finite(tick.change_percent ?? tick.changePercent),
        sourceTimestamp:
          typeof tick.timestamp === 'string'
            ? tick.timestamp
            : typeof message.timestamp === 'string'
              ? message.timestamp
              : null,
        providerMarketState:
          typeof tick.market_state === 'string' ? tick.market_state : null,
        receivedAt,
      }];
    }),
  };
}
