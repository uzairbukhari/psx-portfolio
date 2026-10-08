// Gathers verified face-value evidence (security_face_values) from companies' own PSX disclosures, outside
// Cloudflare (see psx-quote-scrape.mjs). Run by GitHub Actions (.github/workflows/psx-face-values.yml).
//
//   --tickers=A,B     only these (also what an on-demand dispatch passes)
//   --evidence=FILE   JSON array of curated entries from official documents:
//                     [{ticker, faceValue, effectiveFrom ('' or YYYY-MM-DD), sourceUrl, sourceLabel?, evidence?}]
//   --dry-run         read and extract, write nothing
// Default targets: open `facevalue` requests, plus tracked tickers with no evidence that were not tried this week.
//
// Companies the free extractor finds nothing for then go to the AI lookup (lib/ai-face-value.ts), which needs
// OPENAI_API_KEY (or ANTHROPIC_API_KEY with AI_RESEARCH_PROVIDER=anthropic) and is capped by
// FACE_VALUE_AI_MONTHLY_CAP_USD (default $1). Without a key the step is skipped. --no-ai skips it.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission); D1_DATABASE_ID to target staging.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { d1, trackedTickers } from './d1-rest.mjs';
import { markFinished, markRunning } from './refresh-state.mjs';
import { documentText } from './pdf-text.mjs';
import { fetchPsx } from '../lib/psx-fetch.ts';
import { runFaceValues } from '../lib/face-value-run.ts';
import { randomUUID } from 'node:crypto';
import { resolveConfig } from '../lib/ai-research/models.ts';
import { createProvider } from '../lib/ai-research/provider.ts';
import { fetchPageText } from '../lib/ai-research/fetch-text.ts';
import { DEFAULT_MONTHLY_CAP_USD, runAiFaceValues } from '../lib/ai-face-value.ts';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dryRun = process.argv.includes('--dry-run');
const valid = (t) => /^[A-Z0-9]{2,12}$/.test(t ?? '');
const RETRY_AFTER_MS = 7 * 24 * 3_600_000;

async function targets() {
  const explicit = (arg('tickers') ?? '').split(',').map((t) => t.trim().toUpperCase()).filter(valid);
  if (explicit.length) return { tickers: explicit, requested: explicit };
  const requested = (await d1("SELECT ticker FROM refresh_requests WHERE kind='facevalue' AND status IN ('queued','running')").catch(() => [])).map((r) => String(r.ticker)).filter(valid);
  const held = await trackedTickers(undefined);
  const have = new Set((await d1('SELECT DISTINCT ticker FROM security_face_values')).map((r) => String(r.ticker)));
  const tried = new Map((await d1("SELECT key,last_attempt_at FROM refresh_state WHERE kind='face-value'")).map((r) => [String(r.key), String(r.last_attempt_at ?? '')]));
  const stale = held.filter((t) => !have.has(t) && !(tried.get(t) && Date.now() - Date.parse(tried.get(t)) < RETRY_AFTER_MS));
  return { tickers: [...new Set([...requested, ...stale])], requested };
}

/** AI lookup for the targets that still have no evidence after the free extractor. */
async function aiLookup(tickers) {
  const config = resolveConfig(process.env);
  const key = config.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (process.argv.includes('--no-ai') || !config.enabled || !key) { console.log('AI face-value lookup skipped (disabled or no key).'); return null; }
  const have = new Set((await d1('SELECT DISTINCT ticker FROM security_face_values')).map((r) => String(r.ticker)));
  const missing = tickers.filter((t) => !have.has(t));
  if (!missing.length) return null;
  const capEnv = Number(process.env.FACE_VALUE_AI_MONTHLY_CAP_USD);
  const capUsd = Number.isFinite(capEnv) && capEnv > 0 ? capEnv : DEFAULT_MONTHLY_CAP_USD;
  const provider = await createProvider(config, { openaiKey: process.env.OPENAI_API_KEY, anthropicKey: process.env.ANTHROPIC_API_KEY });
  const runId = randomUUID();
  if (!dryRun) await d1("INSERT INTO ai_research_runs (id,started_at,status,provider,models,cost_usd) VALUES (?,?, 'running',?,?,0)", [runId, new Date().toISOString(), config.provider, `face-value:${config.models.read}`]);
  let report;
  try {
    report = await runAiFaceValues({ d1, provider, config, fetchText: fetchPageText, log: (m) => console.log(m) }, { tickers: missing, dryRun, capUsd });
  } catch (error) {
    if (!dryRun) await d1("UPDATE ai_research_runs SET status='failed', error=?, finished_at=? WHERE id=?", [String(error).slice(0, 300), new Date().toISOString(), runId]);
    throw error;
  }
  if (!dryRun) await d1('UPDATE ai_research_runs SET status=?, cost_usd=?, stats=?, finished_at=? WHERE id=?', [report.capped ? 'capped' : 'completed', report.costUsd, JSON.stringify({ perTicker: report.perTicker }), new Date().toISOString(), runId]);
  for (const r of report.perTicker) console.log(`  AI ${r.ticker}: ${r.stored} value(s)${r.skipped ? ` (${r.skipped})` : ''}${r.rejected.length ? ` · rejected: ${r.rejected.slice(0, 2).join(' / ')}` : ''}${r.error ? ` · error: ${r.error}` : ''}`);
  console.log(`AI face values: $${report.costUsd.toFixed(3)} spent${report.capped ? ', cap reached' : ''}.`);
  return report;
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
  const aiReport = await aiLookup(tickers);
  if (requested.length && !dryRun)
    await markFinished('facevalue', report.perTicker.filter((r) => requested.includes(r.ticker)).map((r) => ({ ticker: r.ticker, rows: r.found, error: r.error ?? null })));
  const failed = report.perTicker.filter((r) => r.error).length;
  console.log(`Face values: ${report.perTicker.length} ticker(s), ${report.perTicker.filter((r) => r.found).length} with evidence, ${failed} failed.`);
  process.exitCode = report.perTicker.length && failed / report.perTicker.length > 0.5 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
