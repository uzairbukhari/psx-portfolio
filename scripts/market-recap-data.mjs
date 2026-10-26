// Builds the data for the daily "Market summary" video after the PSX close: KSE-100 result, top gainers and losers,
// most active stocks and today's dividend announcements. Public market data only; nothing from any portfolio.
// PSX drops Cloudflare egress, so this runs on a GitHub runner (see .github/workflows/market-recap.yml).
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (read the dividend announcements; optional, skipped without them).
// Usage: node scripts/market-recap-data.mjs [--out=recap.json]
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { d1 } from './d1-rest.mjs';
import { fetchPsxIndexSummary, fetchPsxTopMovers } from '../lib/psx-market.ts';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const TOP = 3;

const pkDay = (now = new Date()) => new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const trimMover = (m) => ({ symbol: m.symbol, name: m.name, price: m.price, changePercent: m.changePercent, volume: m.volume });

/** One spoken-style sentence set for the narration; the caption and voice-over both start from it. */
export function narration(recap) {
  const { index, gainers, losers, active, dividends } = recap;
  const direction = index.change >= 0 ? 'up' : 'down';
  const pts = Math.abs(index.change).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pct = Math.abs(index.changePercent).toFixed(2);
  const names = (list) => list.map((m) => `${m.symbol}, ${m.changePercent > 0 ? 'up' : 'down'} ${Math.abs(m.changePercent).toFixed(1)} percent`).join('; ');
  const lines = [
    `Market summary for ${recap.date}.`,
    `The KSE-100 closed at ${Math.round(index.close).toLocaleString('en-US')}, ${direction} ${pts} points, or ${pct} percent.`,
  ];
  if (gainers.length) lines.push(`Top gainers: ${names(gainers)}.`);
  if (losers.length) lines.push(`Top losers: ${names(losers)}.`);
  if (active.length) lines.push(`Most traded: ${active.map((m) => m.symbol).join(', ')}.`);
  if (dividends.length)
    lines.push(`Dividend news: ${dividends.map((d) => `${d.ticker} announced ${d.details || d.kind}`).join('; ')}.`);
  lines.push('Plan your monthly investing at sipwise dot trade.');
  return lines.join(' ');
}

export async function buildRecap() {
  const date = pkDay();
  const [index, movers] = await Promise.all([fetchPsxIndexSummary('KSE100'), fetchPsxTopMovers()]);
  let dividends = [];
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    dividends = await d1(
      `SELECT ticker, kind, details, percent FROM dividend_announcements
       WHERE announced_on = ? AND kind = 'cash' ORDER BY percent DESC LIMIT 3`,
      [date],
    ).catch(() => []);
  }
  const recap = {
    date,
    index: { close: index.close, change: index.change, changePercent: index.changePercent, date: index.date },
    gainers: movers.advancers.slice(0, TOP).map(trimMover),
    losers: movers.decliners.slice(0, TOP).map(trimMover),
    active: movers.active.slice(0, TOP).map(trimMover),
    dividends,
  };
  return { ...recap, narration: narration(recap) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const recap = await buildRecap();
  const json = JSON.stringify(recap, null, 2);
  if (outArg) await writeFile(outArg.slice('--out='.length), json);
  console.log(json);
}
