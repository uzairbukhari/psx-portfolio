// Fetches MUFAP's public daily NAV page and stores the fund directory and prices in the shared `fund_catalog` and
// `fund_navs` tables. Public data only. Runs on Cloudflare (MUFAP answers Cloudflare egress, but blocks GitHub's runners).
import { parseMufapNavs, parseMufapPayouts } from './mufap.ts';

/** Fetches a MUFAP page (directly, or through `fetcher`: the cron Worker passes one that runs near Pakistan, see workers/quote-refresh); on a refusal the error names the status and the block page's server/mitigation headers and first words, so a log says why. Retries once after a pause. */
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
  for (let i = 0; i < statements.length; i += 100)
    await db.batch(statements.slice(i, i + 100));
  const newest = navs.reduce((a, n) => (n.date > a ? n.date : a), '');
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
