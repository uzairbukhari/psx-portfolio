// The directory ingestion run, with its I/O injected so the same code drives the GitHub Actions script
// (`scripts/psx-directory-scrape.mjs`, real fetch + D1 REST) and the tests (fixtures + a SQLite look-alike).
// Every write is a per-row upsert and profiles are written batch by batch, so an interrupted run loses at
// most one batch and a rerun resumes from what is stored (bootstrap skips symbols that already have a profile).
import {
  DIRECTORY_ROWS_PER_STATEMENT, DIRECTORY_SELECT, coverageReport, directoryRowParams, directoryUpsertSql, mergeObservation,
  normalizeTicker, parseCompanyProfile, parseListings, parseScreener, parseSymbolsJson, planRun, rowFromStored,
  type CoverageReport, type DirectoryRow, type MergeResult, type Observation, type RunMode,
} from './company-directory.ts';

export type RunIo = {
  d1: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  fetchText: (url: string) => Promise<string>;
  log?: (message: string) => void;
  now?: () => string;
};

export type RunOptions = {
  mode: RunMode;
  dryRun?: boolean;
  /** Most profile fetches in one run (the rest stay incomplete and are picked up next time). */
  limit?: number;
  /** Restrict the run to these symbols (on-demand lookups; may include symbols no list has shown yet). */
  tickers?: string[];
  concurrency?: number;
  /** Consecutive profile failures after which a still-incomplete row is reported `unresolved`. */
  giveUpAfter?: number;
  /** Optional cross-check source: symbols priced in the All-Share table. */
  allShareTickers?: string[];
};

export type RunReport = {
  mode: RunMode;
  dryRun: boolean;
  discovered: number;
  created: number;
  changed: number;
  profilesPlanned: number;
  profilesFetched: number;
  profilesFromFacts: number;
  profilesFailed: { ticker: string; reason: string }[];
  listSourcesFailed: string[];
  coverage: CoverageReport;
  /** Per requested symbol (on-demand mode): the final status. */
  requested: { ticker: string; status: string; reason?: string }[];
};

const SCREENER = 'https://dps.psx.com.pk/screener';
const SYMBOLS = 'https://dps.psx.com.pk/symbols';
const LISTINGS = 'https://dps.psx.com.pk/listings';

const chunk = <T,>(list: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

async function readStored(io: RunIo, tickers: string[]) {
  const stored = new Map<string, DirectoryRow>();
  for (const part of chunk(tickers, 90)) {
    const rows = await io.d1(`SELECT ${DIRECTORY_SELECT} FROM security_catalog WHERE ticker IN (${part.map(() => '?').join(',')})`, part);
    for (const row of rows) stored.set(String(row.ticker), rowFromStored(row as never));
  }
  return stored;
}

async function writeRows(io: RunIo, rows: DirectoryRow[]) {
  for (const part of chunk(rows, DIRECTORY_ROWS_PER_STATEMENT))
    await io.d1(directoryUpsertSql(part.length), part.flatMap(directoryRowParams));
}

/** Verified company-facts rows already scraped (`company_facts`) give a profile with no PSX request. */
async function factsProfiles(io: RunIo, tickers: string[]) {
  const out = new Map<string, Observation>();
  for (const part of chunk(tickers, 90)) {
    const rows = await io.d1(`SELECT ticker,payload FROM company_facts WHERE ticker IN (${part.map(() => '?').join(',')})`, part).catch(() => []);
    for (const row of rows) {
      try {
        const facts = JSON.parse(String(row.payload)) as { name?: string; sector?: string };
        const ticker = String(row.ticker);
        // The facts parser falls back to the ticker / "Unknown" when PSX printed nothing; those are not evidence.
        const obs = parseCompanyProfile(`<div class="quote__name">${facts.name ?? ''}</div><div class="quote__sector"><span>${facts.sector ?? ''}</span>`, ticker, `https://dps.psx.com.pk/company/${ticker}`);
        if (obs && obs.name && obs.sectorName) out.set(ticker, obs);
      } catch { /* a malformed facts row is simply not reused */ }
    }
  }
  return out;
}

async function readFailures(io: RunIo, tickers: string[]) {
  const out = new Map<string, number>();
  for (const part of chunk(tickers, 90)) {
    const rows = await io.d1(`SELECT key,failure_count FROM refresh_state WHERE kind='directory' AND key IN (${part.map(() => '?').join(',')})`, part).catch(() => []);
    for (const row of rows) out.set(String(row.key), Number(row.failure_count ?? 0));
  }
  return out;
}

export async function runDirectory(io: RunIo, options: RunOptions): Promise<RunReport> {
  const log = io.log ?? (() => {});
  const now = io.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const dryRun = !!options.dryRun;
  const concurrency = options.concurrency ?? 3;
  const giveUpAfter = options.giveUpAfter ?? 3;

  // 1. Discover from the lists. Each source may fail on its own; with none left there is nothing to trust.
  const observations: Observation[] = [];
  const listSourcesFailed: string[] = [];
  const screenerTickers: string[] = [];
  const listingsTickers: string[] = [];
  const sources: [string, string, (text: string) => { rows: Observation[]; rejected: number }, string[] | null][] = [
    ['screener', SCREENER, (t) => parseScreener(t), screenerTickers],
    ['symbols', SYMBOLS, (t) => parseSymbolsJson(t), screenerTickers],
    ['listings', LISTINGS, (t) => parseListings(t), listingsTickers],
  ];
  const parsed: Record<string, number> = {};
  for (const [name, url, parse, bucket] of sources) {
    try {
      const { rows, rejected } = parse(await io.fetchText(url));
      if (!rows.length) throw Error('no symbols found');
      observations.push(...rows);
      bucket?.push(...rows.map((r) => r.ticker));
      parsed[name] = rows.length;
      if (rejected) log(`${name}: ${rejected} rows skipped (not a tradable symbol shape)`);
    } catch (error) {
      listSourcesFailed.push(`${name}: ${errorText(error)}`);
    }
  }
  const listed = observations.length > 0;
  if (!listed && !options.tickers?.length) throw Error(`No PSX symbol list could be read (${listSourcesFailed.join('; ')})`);

  // Lower-rank list data first, so a symbol that two lists describe differently is stable run to run.
  const byTicker = new Map<string, Observation[]>();
  for (const obs of observations) byTicker.set(obs.ticker, [...(byTicker.get(obs.ticker) ?? []), obs]);
  const requested = (options.tickers ?? []).map(normalizeTicker).filter((t): t is string => !!t);
  const universe = [...new Set([...byTicker.keys(), ...requested])].sort();

  // 2. Fold the observations into the stored rows.
  const stored = await readStored(io, universe);
  const at = now();
  const merged: MergeResult[] = universe.map((ticker) => {
    let result: MergeResult | null = null;
    let current = stored.get(ticker) ?? null;
    for (const obs of byTicker.get(ticker) ?? []) {
      result = mergeObservation(current, obs, at);
      current = result.row;
    }
    if (!result) {
      // Requested but on no list: keep what is stored, or start an empty row to be profiled.
      result = current
        ? { row: current, changed: false, created: false }
        : { row: mergeObservation(null, { ticker, name: null, sectorName: null, sectorCode: null, securityType: null, listingStatus: null, source: 'profile', sourceUrl: `https://dps.psx.com.pk/company/${ticker}` }, at).row, changed: true, created: true };
    }
    // A merge against several observations is one change relative to what was stored.
    const before = stored.get(ticker);
    return { ...result, created: !before, changed: !before || result.row.fingerprint !== before.fingerprint };
  });
  const plan = planRun(
    requested.length ? merged.filter((m) => requested.includes(m.row.ticker)) : merged,
    options.mode,
    { limit: options.limit },
  );
  log(`Discovered ${universe.length} symbols (${plan.created.length} new, ${plan.changed.length} changed); ${plan.profiles.length} need a profile.`);

  const rows = new Map(merged.map((m) => [m.row.ticker, m.row]));
  if (!dryRun) {
    // Rows that changed (or are new) are saved before any profile work, so discovery is never lost.
    const dirty = merged.filter((m) => m.created || m.changed).map((m) => m.row);
    await writeRows(io, dirty);
  }

  // 3. Profiles: verified facts first (no request), then PSX company pages.
  const fromFacts = await factsProfiles(io, plan.profiles);
  let profilesFromFacts = 0;
  const factRows: DirectoryRow[] = [];
  for (const ticker of plan.profiles) {
    const obs = fromFacts.get(ticker);
    if (!obs) continue;
    const { row } = mergeObservation(rows.get(ticker) ?? null, obs, now());
    rows.set(ticker, row);
    factRows.push(row);
    profilesFromFacts++;
  }
  if (!dryRun) await writeRows(io, factRows);

  const toFetch = plan.profiles.filter((t) => !fromFacts.has(t));
  const failures = await readFailures(io, toFetch);
  const profilesFailed: { ticker: string; reason: string }[] = [];
  let profilesFetched = 0;
  const outcome = new Map<string, string | undefined>();
  for (const batch of chunk(toFetch, concurrency * 5)) {
    // Groups run one after another; inside a group the requests overlap (bounded by `concurrency`).
    const results: ({ ticker: string; obs: Observation } | { ticker: string; error: string })[] = [];
    for (const group of chunk(batch, concurrency))
      results.push(
        ...(await Promise.all(
          group.map(async (ticker) => {
            try {
              const html = await io.fetchText(`https://dps.psx.com.pk/company/${ticker}`);
              const obs = parseCompanyProfile(html, ticker);
              if (!obs || !obs.name || !obs.sectorName) throw Error('The company page carried no name and sector');
              return { ticker, obs };
            } catch (error) {
              return { ticker, error: errorText(error) };
            }
          }),
        )),
      );
    const batchRows: DirectoryRow[] = [];
    const stateSql: [string, unknown[]][] = [];
    for (const result of results) {
      const { ticker } = result;
      if ('obs' in result && result.obs) {
        const { row } = mergeObservation(rows.get(ticker) ?? null, result.obs, now());
        rows.set(ticker, row);
        batchRows.push(row);
        profilesFetched++;
        outcome.set(ticker, undefined);
        stateSql.push([
          `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES ('directory',?,?,?,NULL,0)
           ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_error=NULL, failure_count=0`,
          [ticker, now(), now()],
        ]);
      } else {
        const reason = 'error' in result ? result.error : 'unknown';
        profilesFailed.push({ ticker, reason });
        outcome.set(ticker, reason);
        const count = (failures.get(ticker) ?? 0) + 1;
        failures.set(ticker, count);
        stateSql.push([
          `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES ('directory',?,?,NULL,?,1)
           ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_error=excluded.last_error, failure_count=refresh_state.failure_count+1`,
          [ticker, now(), reason],
        ]);
        const row = rows.get(ticker);
        // Repeated failure marks an incomplete row `unresolved` (reported honestly); values already stored stay.
        if (row && row.resolutionStatus === 'incomplete' && count >= giveUpAfter) {
          const next = { ...row, resolutionStatus: 'unresolved' as const };
          rows.set(ticker, next);
          batchRows.push(next);
        }
      }
    }
    if (!dryRun) {
      await writeRows(io, batchRows);
      for (const [sql, params] of stateSql) await io.d1(sql, params);
    }
    log(`Profiles: ${profilesFetched}/${toFetch.length} fetched, ${profilesFailed.length} failed`);
  }

  const finalRows = [...rows.values()];
  const report: RunReport = {
    mode: options.mode, dryRun, discovered: universe.length, created: plan.created.length, changed: plan.changed.length,
    profilesPlanned: plan.profiles.length, profilesFetched, profilesFromFacts, profilesFailed, listSourcesFailed,
    coverage: coverageReport(finalRows, { screener: screenerTickers, listings: listingsTickers, allShare: options.allShareTickers ?? [] }),
    requested: requested.map((ticker) => {
      const row = rows.get(ticker);
      return { ticker, status: row?.resolutionStatus ?? 'unresolved', reason: outcome.get(ticker) };
    }),
  };
  log(`Run started ${startedAt}: ${report.coverage.resolved} resolved, ${report.coverage.incomplete} incomplete, ${report.coverage.unresolved} unresolved of ${report.discovered}.`);
  return report;
}
