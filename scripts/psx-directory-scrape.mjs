// Fills and maintains the shared company directory (`security_catalog`) from outside Cloudflare (PSX drops
// Cloudflare egress; see psx-quote-scrape.mjs). Run by GitHub Actions (.github/workflows/psx-directory.yml).
//
//   --mode=bootstrap    first load: every discovered symbol that has no company profile yet (resumable)
//   --mode=incremental  daily: new / changed / still-incomplete symbols only (default)
//   --mode=full         explicit full refresh of every symbol's profile
//   --tickers=A,B       on-demand: only these symbols (also fulfils open `company` lookup requests)
//   --limit=N           most profile fetches this run (default 800); the rest is picked up next run
//   --dry-run           read and parse everything, write nothing
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission); D1_DATABASE_ID to target staging.
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { d1 } from './d1-rest.mjs';
import { markFinished, markRunning } from './refresh-state.mjs';
import { fetchPsx } from '../lib/psx-fetch.ts';
import { parseIndexConstituents } from '../lib/psx-market.ts';
import { runDirectory } from '../lib/company-directory-run.ts';
import { normalizeTicker } from '../lib/company-directory.ts';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg('mode') ?? 'incremental';
if (!['bootstrap', 'incremental', 'full'].includes(mode)) throw Error(`Unknown --mode=${mode}`);
const dryRun = process.argv.includes('--dry-run');
const limit = Number(arg('limit') ?? 800);

/** Open on-demand lookups (`refresh_requests` kind 'company'), so a dispatched or scheduled run serves them. */
async function openRequests() {
  const rows = await d1("SELECT ticker FROM refresh_requests WHERE kind='company' AND status IN ('queued','running')").catch(() => []);
  return rows.map((r) => normalizeTicker(r.ticker)).filter(Boolean);
}

async function main() {
  const explicit = (arg('tickers') ?? '').split(',').map(normalizeTicker).filter(Boolean);
  const asked = explicit.length ? explicit : await openRequests();
  const onDemand = asked.length > 0;
  let allShareTickers = [];
  try {
    allShareTickers = parseIndexConstituents(await (await fetchPsx('https://dps.psx.com.pk/indices/ALLSHR')).text()).map((r) => r.symbol);
  } catch (error) {
    console.warn(`All-Share cross-check unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (onDemand && !dryRun) await markRunning('company', asked);
  const report = await runDirectory(
    { d1, fetchText: async (url) => (await fetchPsx(url)).text(), log: (m) => console.log(m) },
    { mode: onDemand ? 'incremental' : mode, dryRun, limit, tickers: onDemand ? asked : undefined, allShareTickers },
  );
  if (onDemand && !dryRun)
    await markFinished(
      'company',
      report.requested.map((r) => ({ ticker: r.ticker, rows: r.status === 'resolved' ? 1 : 0, error: r.status === 'resolved' ? null : (r.reason ?? 'PSX did not provide enough company details.') })),
    );
  const c = report.coverage;
  const lines = [
    `Company directory (${report.mode}${dryRun ? ', dry run' : ''}): ${report.discovered} discovered, ${c.resolved} resolved, ${c.incomplete} incomplete, ${c.unresolved} unresolved, ${c.delisted} delisted.`,
    `Profiles: ${report.profilesFetched} fetched, ${report.profilesFromFacts} from verified facts, ${report.profilesFailed.length} failed of ${report.profilesPlanned} planned.`,
    `Coverage gaps: ${c.screenerOnly.length} in screener only, ${c.listingsOnly.length} in listings only, ${c.allShareOnly.length} priced in All-Share but on neither list.`,
  ];
  if (report.listSourcesFailed.length) lines.push(`Sources unavailable: ${report.listSourcesFailed.join('; ')}`);
  for (const line of lines) console.log(line);
  if (c.screenerOnly.length) console.log(`  screener only: ${c.screenerOnly.slice(0, 40).join(',')}`);
  if (c.listingsOnly.length) console.log(`  listings only: ${c.listingsOnly.slice(0, 40).join(',')}`);
  if (c.allShareOnly.length) console.log(`  All-Share only: ${c.allShareOnly.slice(0, 40).join(',')}`);
  for (const f of report.profilesFailed.slice(0, 40)) console.log(`  profile failed ${f.ticker}: ${f.reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.map((l) => `- ${l}`).join('\n') + '\n');
  // A source outage or a mostly-failed profile pass must surface; a handful of failures must not.
  const failedShare = report.profilesPlanned ? report.profilesFailed.length / report.profilesPlanned : 0;
  process.exitCode = report.listSourcesFailed.length >= 3 || failedShare > 0.5 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
