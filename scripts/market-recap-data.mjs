// Builds the data for the daily "Market summary" video after the PSX close: KSE-100 result, top gainers and losers,
// most active stocks and today's cash dividend announcements, with company names (never tickers) for the screen and
// the voice-over. Public market data only; nothing from any portfolio.
// PSX drops Cloudflare egress, so this runs on a GitHub runner (see .github/workflows/market-recap.yml).
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (read company names, dividends and the KSE-100 intraday line from D1;
// optional, names then come from the PSX pages themselves).
// Usage: node scripts/market-recap-data.mjs [--out=recap.json]
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { d1 } from './d1-rest.mjs';
import { fetchPsxIndexConstituents, fetchPsxIndexSummary } from '../lib/psx-market.ts';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const TOP = 3;
// Tiny prints in thinly traded shares would top the lists, so the All-Share fallback ignores them.
const MIN_VOLUME = 100_000;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const pkDay = (now = new Date()) => new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const trimMover = (m, names) => ({
  name: shortName(names.get(m.symbol) ?? m.name ?? m.symbol),
  price: m.price,
  changePercent: m.changePercent,
});

/** "Meezan Bank Limited" becomes "Meezan Bank": the way a person would say it. */
export function shortName(name) {
  return String(name)
    .replace(/\s*\((?:pvt|private)\)\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,]+(?:limited|ltd|company|co)\.?$/i, '');
}

/** An integer in words, read in small groups ("one hundred sixty-five thousand, four hundred thirty-two"). */
export function intWords(n) {
  n = Math.round(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${intWords(n % 100)}` : ''}`;
  if (n < 1_000_000) return `${intWords(Math.floor(n / 1000))} thousand${n % 1000 ? `,<break time="0.4s"/> ${intWords(n % 1000)}` : ''}`;
  return `${intWords(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? `,<break time="0.4s"/> ${intWords(n % 1_000_000)}` : ''}`;
}

/** A percent in words, one decimal digit read out: 5.2 becomes "five point two percent". */
export function percentWords(p) {
  const [whole, frac] = Math.abs(p).toFixed(2).split('.');
  const digits = frac === '00' ? '' : ` point ${frac.replace(/0$/, '').split('').map((d) => ONES[+d]).join(' ')}`;
  return `${intWords(+whole)}${digits} percent`;
}

const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const pause = (s) => `<break time="${s}s"/>`;

/**
 * One voice-over clip per slide, in Urdu script with English words (index name, company names, numbers,
 * "points", "percent") left in Latin letters so the voice says them in English. The renderer adds a pause after each.
 */
export function spokenParts(recap) {
  const { index, gainers, losers, active, dividends } = recap;
  const move = index.change >= 0 ? 'کا اضافہ' : 'کی کمی';
  const list = (items, word) =>
    items.map((m, i) => `${i === items.length - 1 && items.length > 1 ? 'اور ' : ''}${m.name}، ${percentWords(m.changePercent)} ${word}۔`).join(` ${pause(0.6)} `);
  const parts = [
    `آج کی مارکیٹ سمری، ${weekday(recap.date)}۔ ${pause(0.6)} K S E one hundred انڈیکس آج بند ہوا... ${intWords(index.close)}۔ ${pause(0.5)} یہ ${intWords(index.change)} points ${move} ہے، ${pause(0.4)} یعنی ${percentWords(index.changePercent)}۔`,
    `آج سب سے زیادہ بڑھنے والے شیئرز۔ ${pause(0.6)} ${list(gainers, 'اضافہ')}`,
    `آج سب سے زیادہ گرنے والے شیئرز۔ ${pause(0.6)} ${list(losers, 'کمی')}`,
  ];
  const dividend = dividends.length
    ? `ڈیویڈنڈ کی خبر۔ ${pause(0.6)} ${dividends.map((d) => `${d.name} نے ${percentWords(d.percent)} cash dividend کا اعلان کیا۔`).join(` ${pause(0.6)} `)} ${pause(0.8)} `
    : '';
  parts.push(`${dividend}سب سے زیادہ ٹریڈ ہونے والے شیئرز یہ تھے: ${active.map((m, i) => `${i === active.length - 1 && active.length > 1 ? 'اور ' : ''}${m.name}`).join('، ')}۔`);
  parts.push(`اپنی ماہانہ سرمایہ کاری کی منصوبہ بندی کریں۔ ${pause(0.5)} Sipwise dot trade۔ ${pause(0.5)} روزانہ market updates کے لیے subscribe کریں۔`);
  return parts;
}

export function caption(recap) {
  const { index, gainers, losers, dividends } = recap;
  const sign = index.changePercent >= 0 ? '+' : '-';
  const names = (l) => l.map((m) => m.name).join(', ');
  const div = dividends.length ? ` ${dividends.map((d) => `${d.name} announced a ${d.percent}% cash dividend.`).join(' ')}` : '';
  return `Market summary, ${weekday(recap.date)} ${recap.date}. KSE-100 ${Math.round(index.close).toLocaleString('en-US')} (${sign}${Math.abs(index.changePercent).toFixed(2)}%). Gainers: ${names(gainers)}. Losers: ${names(losers)}.${div} Subscribe for daily market updates. Plan your monthly investing: link in bio. #PSX #KSE100 #Sipwise`;
}

/** Gainers, losers and most traded from a table of index members. */
export function moversFromWatch(rows) {
  const liquid = rows.filter((r) => r.volume >= MIN_VOLUME);
  const by = (key, dir) => [...liquid].sort((a, b) => dir * (b[key] - a[key]));
  return {
    advancers: by('changePercent', 1).filter((r) => r.changePercent > 0),
    decliners: by('changePercent', -1).filter((r) => r.changePercent < 0),
    active: by('volume', 1),
  };
}

/** Movers among the KSE-100 members: the names people know, not thinly traded rights issues and SPACs. */
async function topMovers() {
  return moversFromWatch(await fetchPsxIndexConstituents('KSE100'));
}

export async function buildRecap() {
  const date = pkDay();
  const [index, movers] = await Promise.all([fetchPsxIndexSummary('KSE100'), topMovers()]);
  const names = new Map();
  let dividends = [];
  let line = [];
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    const symbols = [...movers.advancers, ...movers.decliners, ...movers.active].slice(0, 30).map((m) => m.symbol);
    const rows = await d1(`SELECT ticker, name FROM security_catalog WHERE ticker IN (${symbols.map(() => '?').join(',')})`, symbols).catch(() => []);
    for (const row of rows) names.set(row.ticker, row.name);
    const cash = await d1(
      `SELECT ticker, percent FROM dividend_announcements WHERE announced_on = ? AND kind = 'cash' AND percent IS NOT NULL ORDER BY percent DESC LIMIT 2`,
      [date],
    ).catch(() => []);
    if (cash.length) {
      const dn = await d1(`SELECT ticker, name FROM security_catalog WHERE ticker IN (${cash.map(() => '?').join(',')})`, cash.map((c) => c.ticker)).catch(() => []);
      const byTicker = new Map(dn.map((r) => [r.ticker, r.name]));
      dividends = cash.map((c) => ({ name: shortName(byTicker.get(c.ticker) ?? c.ticker), percent: c.percent }));
    }
    const hist = await d1("SELECT intraday FROM price_history WHERE ticker = 'KSE100'").catch(() => []);
    try {
      line = JSON.parse(hist[0]?.intraday ?? '[]').map((p) => p[1]);
    } catch {
      line = [];
    }
  }
  const recap = {
    date,
    marketDate: index.date,
    index: { close: index.close, change: index.change, changePercent: index.changePercent, high: index.high, low: index.low, volume: index.volume, line },
    gainers: movers.advancers.slice(0, TOP).map((m) => trimMover(m, names)),
    losers: movers.decliners.slice(0, TOP).map((m) => trimMover(m, names)),
    active: movers.active.slice(0, TOP).map((m) => trimMover(m, names)),
    dividends,
  };
  return { ...recap, spoken: spokenParts(recap), caption: caption(recap) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const recap = await buildRecap();
  const json = JSON.stringify(recap, null, 2);
  if (outArg) await writeFile(outArg.slice('--out='.length), json);
  console.log(json);
}
