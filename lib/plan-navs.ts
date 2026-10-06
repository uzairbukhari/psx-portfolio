// Pak-Qatar Family Takaful publishes every sub-fund's unit price per day, back to December 2023, on one public page
// (https://pqftl.com.pk/fund-prices/). Public data only; the shared `plan_navs` table holds it. Pure parsing here, the
// fetch and storage below take a D1-like database so the cron Worker and the app can both use them.
import { PAK_QATAR_SUBFUNDS, type PlanNavRow } from './plans.ts';

export const PAK_QATAR_NAV_URL = 'https://pqftl.com.pk/fund-prices/';
/** Column order on the page: Aggressive, Balanced, Conservative, Secure Wealth, Pure Saving, Mustehkam Munafa, Kafalat Pension, Pure Protection, Prosperity. */
const COLUMNS = [
  'aggressive',
  'balanced',
  'conservative',
  'secure-wealth',
  'pure-saving',
  'mustehkam-munafa',
  'kafalat-pension',
  'pure-protection',
  'prosperity',
] as const;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const ROW =
  /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})((?:\s*[|:]?\s*\d[\d,]*\.\d+){9})/gi;

/** Every dated price row on the page. Rows that do not carry all nine prices are skipped, never guessed. */
export function parsePakQatarNavs(html: string): PlanNavRow[] {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
  const out: PlanNavRow[] = [];
  for (const m of text.matchAll(ROW)) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) continue;
    const date = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const prices = [...m[4].matchAll(/\d[\d,]*\.\d+/g)].map((x) =>
      Number(x[0].replace(/,/g, '')),
    );
    if (prices.length !== COLUMNS.length || prices.some((n) => !(n > 0)))
      continue;
    COLUMNS.forEach((fundId, i) => out.push({ fundId, date, nav: prices[i] }));
  }
  return out;
}

type Statement = {
  bind(...values: unknown[]): unknown;
  all<T>(): Promise<{ results: T[] }>;
};
type NavDb = {
  prepare(sql: string): Statement;
  batch(statements: unknown[]): Promise<unknown>;
};
/** Far fewer rows than the real history means the page changed (or loads its table with a script). */
const MIN_ROWS = 9 * 20;

/** Fetches the page and stores prices. After the first run only recent days are written again. */
export async function refreshPlanNavs(db: NavDb) {
  const response = await fetch(PAK_QATAR_NAV_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${response.status} from pqftl.com.pk`);
  const rows = parsePakQatarNavs(await response.text());
  if (rows.length < MIN_ROWS)
    throw new Error(
      `Only ${rows.length} Pak-Qatar prices could be read; the page layout may have changed.`,
    );
  const stored = (
    await db
      .prepare('SELECT MAX(date) AS d FROM plan_navs')
      .all<{ d: string | null }>()
  ).results[0]?.d;
  const from = stored
    ? new Date(Date.parse(`${stored}T00:00:00Z`) - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : '';
  const fresh = rows.filter((r) => r.date >= from);
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO plan_navs (fund_id,date,nav,fetched_at) VALUES (?,?,?,?)
     ON CONFLICT(fund_id,date) DO UPDATE SET nav=excluded.nav, fetched_at=excluded.fetched_at`,
  );
  const statements = fresh.map((r) =>
    upsert.bind(r.fundId, r.date, r.nav, now),
  );
  for (let i = 0; i < statements.length; i += 100)
    await db.batch(statements.slice(i, i + 100));
  const newest = rows.reduce((a, r) => (r.date > a ? r.date : a), '');
  return { rows: rows.length, written: fresh.length, newest };
}

/** The last ~2.5 years of sub-fund prices, oldest first. */
export async function readPlanNavs(
  db: NavDb,
  today: string,
): Promise<PlanNavRow[]> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 900 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await (
    db
      .prepare(
        'SELECT fund_id,date,nav FROM plan_navs WHERE date>=? ORDER BY date,fund_id',
      )
      .bind(from) as unknown as Statement
  ).all<{ fund_id: string; date: string; nav: number }>();
  return rows.results.map((r) => ({
    fundId: r.fund_id,
    date: r.date,
    nav: r.nav,
  }));
}
export const SUBFUND_IDS: readonly string[] = PAK_QATAR_SUBFUNDS.map(
  (f) => f.id,
);
