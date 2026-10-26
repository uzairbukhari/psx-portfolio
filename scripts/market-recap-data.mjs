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
import { fetchPsxIndexSummary, fetchPsxTopMovers } from '../lib/psx-market.ts';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const TOP = 3;
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
    .replace(/[\s,]+(?:limited|ltd\.?|company|co\.?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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

/** One voice-over clip per slide; the renderer adds a pause after each. */
export function spokenParts(recap) {
  const { index, gainers, losers, active, dividends } = recap;
  const dir = index.change >= 0 ? 'up' : 'down';
  const list = (items, verb) =>
    items.map((m, i) => `${i === items.length - 1 && items.length > 1 ? 'And ' : ''}${m.name}, ${verb} ${percentWords(m.changePercent)}.`).join(` ${pause(0.6)} `);
  const parts = [
    `Market summary for ${weekday(recap.date)}. ${pause(0.6)} The K S E one hundred index closed at... ${intWords(index.close)}. ${pause(0.5)} That is ${dir} ${intWords(index.change)} points, ${pause(0.4)} or ${percentWords(index.changePercent)}.`,
    `Top gainers today. ${pause(0.6)} ${list(gainers, 'up')}`,
    `Top losers today. ${pause(0.6)} ${list(losers, 'down')}`,
  ];
  const dividend = dividends.length
    ? `Dividend news. ${pause(0.6)} ${dividends.map((d) => `${d.name} announced a ${percentWords(d.percent)} cash dividend.`).join(` ${pause(0.6)} `)} ${pause(0.8)} `
    : '';
  parts.push(`${dividend}The most traded stocks were ${active.map((m, i) => `${i === active.length - 1 ? 'and ' : ''}${m.name}`).join(', ')}.`);
  parts.push(`Plan your monthly investing. ${pause(0.5)} Sipwise dot trade.`);
  return parts;
}

export function caption(recap) {
  const { index, gainers, losers, dividends } = recap;
  const sign = index.changePercent >= 0 ? '+' : '-';
  const names = (l) => l.map((m) => m.name).join(', ');
  const div = dividends.length ? ` ${dividends.map((d) => `${d.name} announced a ${d.percent}% cash dividend.`).join(' ')}` : '';
  return `Market summary, ${weekday(recap.date)} ${recap.date}. KSE-100 ${Math.round(index.close).toLocaleString('en-US')} (${sign}${Math.abs(index.changePercent).toFixed(2)}%). Gainers: ${names(gainers)}. Losers: ${names(losers)}.${div} Plan your monthly investing: link in bio. #PSX #KSE100 #Sipwise`;
}

export async function buildRecap() {
  const date = pkDay();
  const [index, movers] = await Promise.all([fetchPsxIndexSummary('KSE100'), fetchPsxTopMovers()]);
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
