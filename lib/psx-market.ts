import { fetchPsx } from './psx-fetch.ts';

function num(s: string | undefined): number {
  return Number((s ?? '').replace(/,/g, '').trim());
}

export const SECTOR_NAMES: Record<string, string> = {
  '0801': 'Automobile Assembler',
  '0802': 'Automobile Parts & Accessories',
  '0803': 'Cable & Electrical Goods',
  '0804': 'Cement',
  '0805': 'Chemical',
  '0806': 'Close - End Mutual Fund',
  '0807': 'Commercial Banks',
  '0808': 'Engineering',
  '0809': 'Fertilizer',
  '0810': 'Food & Personal Care Products',
  '0811': 'Glass & Ceramics',
  '0812': 'Insurance',
  '0813': 'Inv. Banks / Inv. Cos. / Securities Cos.',
  '0814': 'Jute',
  '0815': 'Leasing Companies',
  '0816': 'Leather & Tanneries',
  '0818': 'Miscellaneous',
  '0819': 'Modarabas',
  '0820': 'Oil & Gas Exploration Companies',
  '0821': 'Oil & Gas Marketing Companies',
  '0822': 'Paper, Board & Packaging',
  '0823': 'Pharmaceuticals',
  '0824': 'Power Generation & Distribution',
  '0825': 'Refinery',
  '0826': 'Sugar & Allied Industries',
  '0827': 'Synthetic & Rayon',
  '0828': 'Technology & Communication',
  '0829': 'Textile Composite',
  '0830': 'Textile Spinning',
  '0831': 'Textile Weaving',
  '0832': 'Tobacco',
  '0833': 'Transport',
  '0834': 'Vanaspati & Allied Industries',
  '0835': 'Woollen',
  '0836': 'Real Estate Investment Trust',
  '0837': 'Exchange Traded Funds',
  '0838': 'Property',
  '0839': 'Apparel',
};

export interface IndexSummary {
  name: string;
  close: number;
  change: number;
  changePercent: number;
  asOf: string;
  date: string;
  high: number;
  low: number;
  volume: number;
  oneYearChangePercent: number;
  ytdChangePercent: number;
  previousClose: number;
  dayRangeLow: number;
  dayRangeHigh: number;
  weekRangeLow: number;
  weekRangeHigh: number;
  fetchedAt: string;
}

export interface Mover {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

export interface TopMovers {
  active: Mover[];
  advancers: Mover[];
  decliners: Mover[];
  fetchedAt: string;
}

export interface SectorPerformance {
  sector: string;
  changePercent: number;
  companyCount: number;
}

export interface MarketWatchQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  sourceTimestamp: string | null;
  retrievedAt: string;
}

export interface MarketState {
  isOpen: boolean;
  label: 'Open' | 'Closed' | 'Friday break';
  estimated: boolean;
  timeZone: 'Asia/Karachi';
}

export interface ShortlistPerformance {
  ticker: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  sourceTimestamp: string | null;
  retrievedAt: string | null;
  intraday: IndexPoint[];
}

export interface IndexPoint {
  time: number;
  value: number;
}

export function parseIndexSummary(html: string, indexName = 'KSE100'): IndexSummary {
  const blockStart = html.indexOf(`<div class="tabs__panel marketIndices__details" data-name="${indexName}"`);
  if (blockStart === -1) throw Error(`Index "${indexName}" not found in PSX markup`);
  const nextPanel = html.indexOf('<div class="tabs__panel marketIndices__details"', blockStart + 1);
  const block = html.slice(blockStart, nextPanel === -1 ? undefined : nextPanel);

  const meta = block.match(/data-date="([^"]+)"[^>]*data-close="([^"]+)"/);
  const changeMatch = block.match(
    /marketIndices__change change__text--(pos|neg)">(?:<i[^>]*><\/i>)?\s*([\d,.]+)\s*\(([-\d.]+)%\)/,
  );
  const stat = (label: string) =>
    block.match(
      new RegExp(`stats_label">${label}</div><div class="stats_value[^"]*">(?:<i[^>]*></i>)?\\s*([-\\d,.]+)`),
    )?.[1];
  const ranges = [...block.matchAll(/class="numRange" data-low="([^"]+)" data-high="([^"]+)"/g)];

  if (!meta || !changeMatch || ranges.length < 2)
    throw Error(`Unexpected PSX index markup for "${indexName}" (${block.length} bytes)`);

  const close = num(meta[2]);
  const change = num(changeMatch[2]) * (changeMatch[1] === 'neg' ? -1 : 1);
  const asOf = meta[1];
  if (!Number.isFinite(close) || close <= 0) throw Error(`Unexpected PSX index price for "${indexName}"`);

  return {
    name: indexName,
    close,
    change,
    changePercent: num(changeMatch[3]),
    asOf,
    date: asOf.slice(0, 10),
    high: num(stat('High')),
    low: num(stat('Low')),
    volume: num(stat('Volume')),
    oneYearChangePercent: num(stat('1-Year Change')),
    ytdChangePercent: num(stat('YTD Change')),
    previousClose: num(stat('Previous Close')),
    dayRangeLow: num(ranges[0][1]),
    dayRangeHigh: num(ranges[0][2]),
    weekRangeLow: num(ranges[1][1]),
    weekRangeHigh: num(ranges[1][2]),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchPsxIndexSummary(indexName = 'KSE100'): Promise<IndexSummary> {
  const response = await fetchPsx('https://dps.psx.com.pk/');
  return parseIndexSummary(await response.text(), indexName);
}

const ROW_RE =
  /<a class="tbl__symbol" href="\/company\/([A-Z0-9]+)" data-tippy="([^"]*)"><strong>[^<]+<\/strong><\/a>(?:<div class="tag[^>]*>[^<]*<\/div>)?<\/td><td class="right">([^<]+)<\/td><td class="nowrap right change__text--(?:pos|neg)"><i[^>]*><\/i>\s*(-?[\d,.]+)<span[^>]*>\s*\(([-\d.]+)%\)<\/span><\/td><td class="right">([^<]+)<\/td>/g;

function parseMoverRows(section: string): Mover[] {
  return [...section.matchAll(ROW_RE)].map((m) => ({
    symbol: m[1],
    name: m[2],
    price: num(m[3]),
    change: num(m[4]),
    changePercent: num(m[5]),
    volume: num(m[6]),
  }));
}

export function parseTopMovers(html: string): TopMovers {
  const sectionFor = (heading: string) => {
    const start = html.indexOf(`marketPerf__heading">${heading}`);
    if (start === -1) return '';
    const nextStart = html.indexOf('marketPerf__heading">', start + 1);
    return html.slice(start, nextStart === -1 ? undefined : nextStart);
  };
  const active = parseMoverRows(sectionFor('TOP ACTIVE STOCKS'));
  const advancers = parseMoverRows(sectionFor('TOP ADVANCERS'));
  const decliners = parseMoverRows(sectionFor('TOP DECLINERS'));
  if (!active.length && !advancers.length && !decliners.length)
    throw Error(`Unexpected PSX performers markup (${html.length} bytes)`);
  return { active, advancers, decliners, fetchedAt: new Date().toISOString() };
}

export async function fetchPsxTopMovers(): Promise<TopMovers> {
  const response = await fetchPsx('https://dps.psx.com.pk/performers');
  return parseTopMovers(await response.text());
}

const WATCH_ROW_RE =
  /<td data-search="[A-Z0-9]+" data-order="[A-Z0-9]+"><a class="tbl__symbol"[\s\S]*?<\/a><\/td><td>(\d{4})<\/td>[\s\S]*?<td class="right change__text--(?:pos|neg)" data-order="-?[\d.]+">[\s\S]*?<\/td><td class="right change__text--(?:pos|neg)" data-order="(-?[\d.]+)">/g;

export function parseSectorPerformance(html: string): SectorPerformance[] {
  const totals = new Map<string, { sum: number; count: number }>();
  // Equal-weight average per sector (not volume/value-weighted) — PSX exposes no
  // sector-level aggregate endpoint, only per-company rows tagged with a sector code.
  for (const [, code, pct] of html.matchAll(WATCH_ROW_RE)) {
    const name = SECTOR_NAMES[code];
    if (!name) continue;
    const entry = totals.get(name) ?? { sum: 0, count: 0 };
    entry.sum += num(pct);
    entry.count += 1;
    totals.set(name, entry);
  }
  if (!totals.size) throw Error(`Unexpected PSX market-watch markup (${html.length} bytes)`);
  return [...totals.entries()]
    .map(([sector, { sum, count }]) => ({
      sector,
      changePercent: Math.round((sum / count) * 100) / 100,
      companyCount: count,
    }))
    .sort((a, b) => b.changePercent - a.changePercent);
}

export function parseMarketWatch(
  html: string,
  retrievedAt = new Date().toISOString(),
): MarketWatchQuote[] {
  const rows: MarketWatchQuote[] = [];
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = match[1];
    const symbolMatch = row.match(
      /data-search="([A-Z0-9]+)"[\s\S]*?data-title="([^"]*)"/,
    );
    if (!symbolMatch) continue;
    const values = [...row.matchAll(/data-order="(-?[\d.]+)"/g)].map((item) =>
      num(item[1]),
    );
    if (values.length < 8 || values.some((value) => !Number.isFinite(value)))
      continue;
    const [, _open, high, low, price, change, changePercent, volume] = values;
    if (price < 0 || high < 0 || low < 0 || volume < 0) continue;
    rows.push({
      symbol: symbolMatch[1],
      name: symbolMatch[2],
      price,
      change,
      changePercent,
      volume,
      high,
      low,
      sourceTimestamp: null,
      retrievedAt,
    });
  }
  if (!rows.length)
    throw Error(`Unexpected PSX market-watch markup (${html.length} bytes)`);
  return rows;
}

export async function fetchPsxMarketWatch(): Promise<MarketWatchQuote[]> {
  const response = await fetchPsx('https://dps.psx.com.pk/market-watch');
  const retrievedAt = new Date().toISOString();
  return parseMarketWatch(await response.text(), retrievedAt);
}

export function pakistanMarketState(at = new Date()): MarketState {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const weekday = part('weekday');
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  if (weekday === 'Fri') {
    const morning = minutes >= 9 * 60 + 17 && minutes < 12 * 60;
    const afternoon = minutes >= 14 * 60 + 32 && minutes < 16 * 60 + 30;
    return {
      isOpen: morning || afternoon,
      label:
        minutes >= 12 * 60 && minutes < 14 * 60 + 32
          ? 'Friday break'
          : morning || afternoon
            ? 'Open'
            : 'Closed',
      estimated: true,
      timeZone: 'Asia/Karachi',
    };
  }
  const weekdayOpen = ['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday);
  const isOpen = weekdayOpen && minutes >= 9 * 60 + 32 && minutes < 15 * 60 + 30;
  return {
    isOpen,
    label: isOpen ? 'Open' : 'Closed',
    estimated: true,
    timeZone: 'Asia/Karachi',
  };
}

export function selectShortlistPerformance(
  shortlist: string[],
  companies: { ticker: string; name: string }[],
  quotes: MarketWatchQuote[],
  fallback: Record<string, { price: number; asOf: string; fetchedAt: string }> = {},
): ShortlistPerformance[] {
  const names = new Map(companies.map((company) => [company.ticker, company.name]));
  const byTicker = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return shortlist.map((ticker) => {
    const quote = byTicker.get(ticker);
    const cached = fallback[ticker];
    return {
      ticker,
      name: names.get(ticker) ?? quote?.name ?? ticker,
      price: quote?.price ?? cached?.price ?? null,
      change: quote?.change ?? null,
      changePercent: quote?.changePercent ?? null,
      volume: quote?.volume ?? null,
      high: quote?.high ?? null,
      low: quote?.low ?? null,
      previousClose: quote ? quote.price - quote.change : null,
      sourceTimestamp: quote?.sourceTimestamp ?? cached?.asOf ?? null,
      retrievedAt: quote?.retrievedAt ?? cached?.fetchedAt ?? null,
      intraday: [],
    };
  });
}

export async function fetchPsxSectorPerformance(): Promise<SectorPerformance[]> {
  const response = await fetchPsx('https://dps.psx.com.pk/market-watch');
  return parseSectorPerformance(await response.text());
}

export function downsample(points: IndexPoint[], limit: number): IndexPoint[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]);
}

export async function fetchPsxIndexSeries(indexName = 'KSE100', limit = 60): Promise<IndexPoint[]> {
  const response = await fetchPsx(`https://dps.psx.com.pk/timeseries/int/${indexName}`);
  const body = (await response.json()) as { status: number; data: [number, number, number][] };
  if (body.status !== 1 || !Array.isArray(body.data))
    throw Error('Unexpected PSX timeseries response');
  const chronological = [...body.data].reverse().map(([time, value]) => ({ time, value }));
  return downsample(chronological, limit);
}
