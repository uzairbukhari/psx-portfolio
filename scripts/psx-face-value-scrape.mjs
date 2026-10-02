// Gathers verified face-value evidence (security_face_values) from companies' own PSX disclosures, outside
// Cloudflare (see psx-quote-scrape.mjs). Run by GitHub Actions (.github/workflows/psx-face-values.yml).
//
//   --tickers=A,B     only these (also what an on-demand dispatch passes)
//   --evidence=FILE   JSON array of curated entries from official documents:
//                     [{ticker, faceValue, effectiveFrom ('' or YYYY-MM-DD), sourceUrl, sourceLabel?, evidence?}]
//   --dry-run         read and extract, write nothing
// Default targets: open `facevalue` requests, plus held tickers with no evidence that were not tried this week.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission); D1_DATABASE_ID to target staging.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { d1, heldTickers } from './d1-rest.mjs';
import { markFinished, markRunning } from './refresh-state.mjs';
import { documentText } from './pdf-text.mjs';
import { fetchPsx } from '../lib/psx-fetch.ts';
import { runFaceValues } from '../lib/face-value-run.ts';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dryRun = process.argv.includes('--dry-run');
const valid = (t) => /^[A-Z0-9]{2,12}$/.test(t ?? '');
const RETRY_AFTER_MS = 7 * 24 * 3_600_000;

async function targets() {
  const explicit = (arg('tickers') ?? '').split(',').map((t) => t.trim().toUpperCase()).filter(valid);
  if (explicit.length) return { tickers: explicit, requested: explicit };
  const requested = (await d1("SELECT ticker FROM refresh_requests WHERE kind='facevalue' AND status IN ('queued','running')").catch(() => [])).map((r) => String(r.ticker)).filter(valid);
  const held = await heldTickers(undefined);
  const have = new Set((await d1('SELECT DISTINCT ticker FROM security_face_values')).map((r) => String(r.ticker)));
  const tried = new Map((await d1("SELECT key,last_attempt_at FROM refresh_state WHERE kind='face-value'")).map((r) => [String(r.key), String(r.last_attempt_at ?? '')]));
  const stale = held.filter((t) => !have.has(t) && !(tried.get(t) && Date.now() - Date.parse(tried.get(t)) < RETRY_AFTER_MS));
  return { tickers: [...new Set([...requested, ...stale])], requested };
}

async function main() {
  const { tickers, requested } = await targets();
  const evidenceFile = arg('evidence');
  const curated = evidenceFile ? JSON.parse(readFileSync(evidenceFile, 'utf8')) : [];
  if (requested.length && !dryRun) await markRunning('facevalue', requested);
  const report = await runFaceValues(
    { d1, fetchDocument: async (url) => documentText(await fetchPsx(url)), log: (m) => console.log(m) },
    { tickers, dryRun, curated },
  );
  for (const r of report.perTicker)
    console.log(`  ${r.ticker}: ${r.found} evidence row(s) from ${r.documents} document(s)${r.conflicts ? `, ${r.conflicts} conflict(s)` : ''}${r.error ? `, error: ${r.error}` : ''}${r.unclear.length ? ` · unclear: ${r.unclear.slice(0, 2).join(' / ')}` : ''}`);
  if (requested.length && !dryRun)
    await markFinished('facevalue', report.perTicker.filter((r) => requested.includes(r.ticker)).map((r) => ({ ticker: r.ticker, rows: r.found, error: r.error ?? null })));
  const failed = report.perTicker.filter((r) => r.error).length;
  console.log(`Face values: ${report.perTicker.length} ticker(s), ${report.perTicker.filter((r) => r.found).length} with evidence, ${failed} failed.`);
  process.exitCode = report.perTicker.length && failed / report.perTicker.length > 0.5 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
