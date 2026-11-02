// Fetches MUFAP's public daily NAV page and stores the fund directory and prices in the shared `fund_catalog` and
// `fund_navs` tables. Public data only.
//
// MUFAP's Cloudflare bot check scores a Worker's fetch by the person whose request started it. A fetch made while
// answering a signed-in browser (the admin button, a visit) passes; a Cron Trigger has nobody behind it and always gets
// the "Just a moment" challenge (45 of 45 cron runs failed, 12 Oct to 2 Nov 2026, from every placement tried), as do
// GitHub's runners. So the prices are refreshed on visits: `freshenFunds` below, called from the web app's load.
import { parseMufapNavs, parseMufapPayouts } from './mufap.ts';
import { recordJobRun } from './job-runs.ts';

/** Fetches a MUFAP page (directly, or through `fetcher`, for tests); on a refusal the error names the status and the block page's server/mitigation headers and first words, so a log says why. Retries once after a pause. */
export type MufapFetcher = (url: string, init: RequestInit) => Promise<Response>;

async function fetchMufap(url: string, fetcher: MufapFetcher = fetch) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 5000));
    const response = await fetcher(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.mufap.com.pk/',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) return response;
    const snippet = (await response.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    last = `${response.status} from mufap.com.pk (server ${response.headers.get('server') ?? '?'}, mitigated ${response.headers.get('cf-mitigated') ?? 'no'}${snippet ? `, "${snippet}"` : ''})`;
  }
  throw new Error(last);
}

const URL_ = 'https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=3';
const PAYOUTS_URL = 'https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=4';
/** Far fewer than the real list means the page changed: fail loudly instead of storing a fragment. */
const MIN_FUNDS = 50;
/** The payouts page lists a row per fund that ever paid; far fewer means the layout changed. */
const MIN_PAYOUTS = 20;

type Statement = {
  bind(...values: unknown[]): unknown;
  all<T>(): Promise<{ results: T[] }>;
};
type FundDb = {
  prepare(sql: string): Statement;
  batch(statements: unknown[]): Promise<unknown>;
};
/** Most funds one signed-in request may add, and the most the shared list may ever hold. */
const MAX_PER_REQUEST = 50;
const MAX_TRACKED = 3000;
const RETRY_GAP_MS = 2 * 60_000;

export async function refreshFunds(db: FundDb, fetcher?: MufapFetcher) {
  const response = await fetchMufap(URL_, fetcher);
  const { catalog, navs } = parseMufapNavs(await response.text());
  if (catalog.length < MIN_FUNDS)
    throw new Error(
      `Only ${catalog.length} funds could be read from MUFAP; the page layout may have changed.`,
    );
  const tracked = new Set(
    (
      await db
        .prepare('SELECT mufap_id FROM tracked_funds')
        .all<{ mufap_id: string }>()
    ).results.map((r) => r.mufap_id),
  );
  const now = new Date().toISOString();
  const upsertFund = db.prepare(
    `INSERT INTO fund_catalog (mufap_id,amc,fund_name,category,sector,inception_date,updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(mufap_id) DO UPDATE SET amc=excluded.amc, fund_name=excluded.fund_name, category=excluded.category, sector=excluded.sector, inception_date=excluded.inception_date, updated_at=excluded.updated_at`,
  );
  const upsertNav = db.prepare(
    `INSERT INTO fund_navs (mufap_id,date,nav,offer,repurchase,fetched_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(mufap_id,date) DO UPDATE SET nav=excluded.nav, offer=excluded.offer, repurchase=excluded.repurchase, fetched_at=excluded.fetched_at`,
  );
  const statements = [
    ...catalog.map((f) =>
      upsertFund.bind(
        f.mufapId,
        f.amc,
        f.fundName,
        f.category,
        f.sector,
        f.inceptionDate,
        now,
      ),
    ),
    ...navs
      .filter((n) => tracked.has(n.mufapId))
      .map((n) =>
        upsertNav.bind(n.mufapId, n.date, n.nav, n.offer, n.repurchase, now),
      ),
  ];
  statements.push(
    db
      .prepare(
        `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES ('funds','mufap',?,?,NULL,0)
         ON CONFLICT(kind,key) DO UPDATE SET last_success_at=excluded.last_success_at, last_error=NULL, failure_count=0`,
      )
      .bind(now, now),
  );
  const newest = navs.reduce((a, n) => (n.date > a ? n.date : a), '');
  // The newest price date MUFAP showed (row key 'newest', date kept in last_success_at): visits stop once it is today's.
  if (newest)
    statements.push(
      db
        .prepare(
          `INSERT INTO refresh_state (kind,key,last_success_at,failure_count) VALUES ('funds','newest',?,0)
           ON CONFLICT(kind,key) DO UPDATE SET last_success_at=excluded.last_success_at`,
        )
        .bind(newest),
    );
  for (let i = 0; i < statements.length; i += 100)
    await db.batch(statements.slice(i, i + 100));
  return {
    funds: catalog.length,
    tracked: tracked.size,
    prices: navs.filter((n) => tracked.has(n.mufapId)).length,
    newest,
  };
}

/**
 * Remembers that these funds are held by somebody, so their price is stored every night. Only public fund ids are
 * sent, never units, amounts or whose they are. A fund seen for the first time (or an empty directory) triggers one
 * fetch straight away, so its price does not wait for the night run.
 */
export async function trackFunds(db: FundDb, ids: unknown, retry = false) {
  if (!Array.isArray(ids) || ids.length > MAX_PER_REQUEST)
    throw new Error('Invalid fund list.');
  const wanted = [...new Set(ids)].filter(
    (id): id is string => typeof id === 'string' && /^\d{1,8}$/.test(id),
  );
  const known = new Set(
    (
      await db
        .prepare('SELECT mufap_id FROM tracked_funds')
        .all<{ mufap_id: string }>()
    ).results.map((r) => r.mufap_id),
  );
  const fresh = wanted.filter((id) => !known.has(id));
  const directory =
    (
      await db
        .prepare('SELECT 1 AS n FROM fund_catalog LIMIT 1')
        .all<{ n: number }>()
    ).results[0]?.n ?? 0;
  if (known.size + fresh.length > MAX_TRACKED)
    throw new Error('Too many funds are tracked.');
  if (fresh.length) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO tracked_funds (mufap_id, first_seen) VALUES (?, ?)',
    );
    const now = new Date().toISOString();
    await db.batch(fresh.map((id) => insert.bind(id, now)));
  }
  // A retry asks for a fresh fetch even when nothing is new, but not more than once every couple of minutes for everyone.
  let wantRetry = false;
  if (retry && !fresh.length && directory) {
    const last =
      (
        await db
          .prepare('SELECT MAX(updated_at) AS t FROM fund_catalog')
          .all<{ t: string | null }>()
      ).results[0]?.t ?? '';
    wantRetry = !last || Date.now() - Date.parse(last) > RETRY_GAP_MS;
  }
  const refreshed = fresh.length > 0 || !directory || wantRetry;
  if (refreshed) await refreshFunds(db);
  // `refreshed` tells the client whether prices may have changed, so it re-reads the catalogue only then.
  return { added: fresh.length, refreshed };
}

/**
 * Stores MUFAP's payouts (per unit, ex-NAV, date) for every fund, not only tracked ones: a payout is one small row, and a
 * fund added later then already has its history. The page shows each fund's latest payout, so a night that fails to run
 * loses a daily payer's day; clients then fall back to matching their statement.
 */
export async function refreshFundPayouts(db: FundDb, fetcher?: MufapFetcher) {
  const response = await fetchMufap(PAYOUTS_URL, fetcher);
  const payouts = parseMufapPayouts(await response.text());
  if (payouts.length < MIN_PAYOUTS)
    throw new Error(
      `Only ${payouts.length} payouts could be read from MUFAP; the page layout may have changed.`,
    );
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO fund_payouts (mufap_id,payout_date,per_unit,ex_nav,fetched_at) VALUES (?,?,?,?,?)
     ON CONFLICT(mufap_id,payout_date) DO UPDATE SET per_unit=excluded.per_unit, ex_nav=excluded.ex_nav, fetched_at=excluded.fetched_at`,
  );
  const statements = payouts.map((p) =>
    upsert.bind(p.mufapId, p.payoutDate, p.perUnit, p.exNav, now),
  );
  for (let i = 0; i < statements.length; i += 100)
    await db.batch(statements.slice(i, i + 100));
  return {
    payouts: payouts.length,
    newest: payouts.reduce((a, p) => (p.payoutDate > a ? p.payoutDate : a), ''),
  };
}

/** Prices older than this are refreshed by the next signed-in visit. MUFAP publishes once a day, at no fixed hour. */
export const FUNDS_STALE_MS = 4 * 3600_000;
/** After any attempt (good or failed), nobody tries again for this long: the claim below doubles as a lock. */
export const FUNDS_RETRY_MS = 20 * 60_000;

/** The latest weekday on or before today in Pakistan (UTC+5): the newest price date MUFAP can have. */
export function expectedNavDate(now: Date): string {
  const d = new Date(now.getTime() + 5 * 3600_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: whether a visit should fetch MUFAP now. Never within FUNDS_RETRY_MS of the last attempt; never once the stored
 * prices are dated the latest weekday (so one or two fetches a day, none at weekends once Friday's are in); otherwise
 * when the last good refresh is over FUNDS_STALE_MS old (MUFAP posts at no fixed hour, holidays never reach "today").
 */
export function fundsFreshenDue(
  state: { lastAttemptAt: string | null; lastSuccessAt: string | null; newest?: string | null } | null,
  now: Date,
): boolean {
  const t = now.getTime();
  const attempt = state?.lastAttemptAt ? Date.parse(state.lastAttemptAt) : NaN;
  if (Number.isFinite(attempt) && t - attempt < FUNDS_RETRY_MS) return false;
  if (state?.newest && state.newest >= expectedNavDate(now)) return false;
  const success = state?.lastSuccessAt ? Date.parse(state.lastSuccessAt) : NaN;
  return !(Number.isFinite(success) && t - success < FUNDS_STALE_MS);
}

/**
 * Called on a signed-in web visit (POST /api/public-data/funds `{freshen:true}`). Usually one row read and nothing else;
 * when the prices are stale it claims the refresh (one visitor at a time, see FUNDS_RETRY_MS) and fetches MUFAP while
 * answering that visitor, which is what lets the fetch past MUFAP's bot check. Records a `visit` job run either way.
 */
export async function freshenFunds(db: D1Database, now = new Date()) {
  // Two rows: 'mufap' (attempt and success times) and 'newest' (the newest price date stored).
  const rows = (
    await db
      .prepare(
        "SELECT key, last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt FROM refresh_state WHERE kind='funds' AND key IN ('mufap','newest')",
      )
      .bind()
      .all<{ key: string; lastAttemptAt: string | null; lastSuccessAt: string | null }>()
  ).results;
  const main = rows.find((r) => r.key === 'mufap');
  const row = main
    ? { ...main, newest: rows.find((r) => r.key === 'newest')?.lastSuccessAt ?? null }
    : null;
  if (!fundsFreshenDue(row, now)) return { ran: false as const };
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - FUNDS_RETRY_MS).toISOString();
  const claim = await db
    .prepare(
      `INSERT INTO refresh_state (kind,key,last_attempt_at,failure_count) VALUES ('funds','mufap',?,0)
       ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at
       WHERE refresh_state.last_attempt_at IS NULL OR refresh_state.last_attempt_at < ?`,
    )
    .bind(at, cutoff)
    .run();
  // Another visitor claimed it a moment ago.
  if (claim.meta?.changes === 0) return { ran: false as const };
  try {
    const funds = await refreshFunds(db);
    await refreshFundPayouts(db).catch(() => {});
    await recordJobRun(db, { job: 'funds', source: 'visit', startedAt: at, ok: true, detail: `${funds.funds} funds, ${funds.prices} prices` }).catch(() => {});
    return { ran: true as const, ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db
      .prepare(
        "UPDATE refresh_state SET last_error=?, failure_count=failure_count+1 WHERE kind='funds' AND key='mufap'",
      )
      .bind(detail.slice(0, 300))
      .run()
      .catch(() => {});
    await recordJobRun(db, { job: 'funds', source: 'visit', startedAt: at, ok: false, detail }).catch(() => {});
    return { ran: true as const, ok: false };
  }
}
