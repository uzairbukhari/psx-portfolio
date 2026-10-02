// Refreshes the shared `dividend_announcements` table from outside Cloudflare
// (PSX drops Cloudflare egress; see psx-quote-scrape.mjs). For every ticker held
// in some portfolio it reads the company Payouts table and upserts each cash,
// bonus and right announcement. Portfolios turn cash rows into dividends.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-payout-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK]
import { pathToFileURL } from 'node:url';
import { d1, heldTickers } from './d1-rest.mjs';
import { scrapeExitCode } from './scrape-exit.mjs';
import { markFinished, markRunning } from './refresh-state.mjs';
import { fetchPsxPayoutsHtml } from '../lib/psx-fetch.ts';
import { parsePayouts } from '../lib/psx-payouts.ts';
import { announcementKey, buildPushMessages, newAnnouncements } from '../lib/dividend-push.ts';

// D1 allows 100 bound parameters per statement; 10 per row.
const ROWS_PER_STATEMENT = 9;
const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

async function upsert(rows, fetchedAt) {
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    await d1(
      `INSERT INTO dividend_announcements
         (ticker,book_closure_start,announced_on,kind,book_closure_end,period,details,percent,per_share_rs,fetched_at)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
       ON CONFLICT(ticker,book_closure_start,announced_on,kind) DO UPDATE SET
         book_closure_end=excluded.book_closure_end,
         period=excluded.period, details=excluded.details, percent=excluded.percent,
         per_share_rs=excluded.per_share_rs, fetched_at=excluded.fetched_at`,
      chunk.flatMap((r) => [
        r.ticker, r.bookClosureStart, r.announcedOn, r.kind, r.bookClosureEnd,
        r.period, r.details, r.percent, r.perShareRs, fetchedAt,
      ]),
    );
  }
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Tells phones that hold a company about its newly seen announcements. Never fails the scrape. */
async function notifyPhones(rows, before) {
  const fresh = newAnnouncements(rows, before.keys, before.tickers);
  if (!fresh.length) return;
  const sessions = await d1(
    `SELECT s.email AS email, s.push_token AS token, p.payload AS payload
     FROM mobile_sessions s JOIN portfolios p ON lower(p.user_id)=lower(s.email)
     WHERE s.revoked_at IS NULL AND s.push_token IS NOT NULL`,
  );
  const recipients = sessions.map((row) => ({
    email: row.email,
    token: row.token,
    tickers: new Set(
      (JSON.parse(row.payload).companies ?? []).map((c) => String(c.ticker).toUpperCase()),
    ),
  }));
  const messages = buildPushMessages(fresh, recipients);
  console.log(`Push: ${fresh.length} new announcements, ${messages.length} notifications.`);
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    const body = await response.json().catch(() => null);
    const tickets = Array.isArray(body?.data) ? body.data : [];
    // A token Expo no longer knows belongs to an uninstalled app: forget it.
    for (const [index, ticket] of tickets.entries())
      if (ticket?.details?.error === 'DeviceNotRegistered')
        await d1('UPDATE mobile_sessions SET push_token=NULL WHERE push_token=?', [batch[index].to]);
  }
}

async function main() {
  const tickers = await heldTickers(tickerArg);
  const rows = [];
  const failed = [];
  const results = [];
  if (!dryRun) await markRunning('payouts', tickers).catch((error) => console.log(`Request state not updated: ${error.message}`));
  for (const ticker of tickers) {
    try {
      const found = parsePayouts(await fetchPsxPayoutsHtml(ticker), ticker);
      rows.push(...found);
      // A page with no announcements is a successful empty fetch, not a failure.
      results.push({ ticker, rows: found.length, coverageFrom: found.map((r) => r.announcedOn).sort()[0] ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`${ticker}: ${message}`);
      results.push({ ticker, error: message });
    }
  }
  console.log(
    `PSX payouts: ${rows.length} announcements for ${tickers.length - failed.length}/${tickers.length} tickers` +
      (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  if (dryRun) {
    for (const r of rows.slice(0, 40))
      console.log(`  ${r.ticker} ${r.bookClosureStart} ${r.kind} ${r.percent ?? 'Rs' + r.perShareRs} (${r.details})`);
  } else {
    const stored = await d1(
      'SELECT ticker, book_closure_start AS bookClosureStart, announced_on AS announcedOn, kind FROM dividend_announcements',
    );
    const before = { keys: new Set(stored.map(announcementKey)), tickers: new Set(stored.map((r) => r.ticker)) };
    await upsert(rows, new Date().toISOString());
    await markFinished('payouts', results).catch((error) => console.log(`Request state not updated: ${error.message}`));
    await notifyPhones(rows, before).catch((error) => console.log(`Push notifications skipped: ${error instanceof Error ? error.message : error}`));
  }
  process.exitCode = scrapeExitCode(tickers.length, failed.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
