// Reads the shared MUFAP fund directory and prices. Public data: takes no user and no portfolio. The directory is sent
// whole; a single fund's price history is only returned when its MUFAP id is asked for (a fund's name is not private).
import type {
  FundCatalogResponse,
  FundHistoryResponse,
  FundNavRow,
} from './mufap.ts';

type FundDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
    all<T>(): Promise<{ results: T[] }>;
  };
};
type CatalogRow = {
  mufap_id: string;
  amc: string;
  fund_name: string;
  category: string;
  sector: string;
  inception_date: string | null;
};
type NavRow = {
  mufap_id: string;
  date: string;
  nav: number;
  offer: number;
  repurchase: number;
  fetched_at: string;
};
const toNav = (r: NavRow): FundNavRow => ({
  mufapId: r.mufap_id,
  date: r.date,
  nav: r.nav,
  offer: r.offer,
  repurchase: r.repurchase,
  fetchedAt: r.fetched_at,
});

/** Every fund with its newest price. */
export async function readFundCatalog(
  db: FundDb,
): Promise<FundCatalogResponse> {
  const [catalog, latest] = await Promise.all([
    db
      .prepare(
        'SELECT mufap_id,amc,fund_name,category,sector,inception_date FROM fund_catalog ORDER BY amc,fund_name',
      )
      .all<CatalogRow>(),
    db
      .prepare(
        'SELECT n.mufap_id,n.date,n.nav,n.offer,n.repurchase,n.fetched_at FROM fund_navs n JOIN (SELECT mufap_id, MAX(date) AS d FROM fund_navs GROUP BY mufap_id) m ON m.mufap_id=n.mufap_id AND m.d=n.date',
      )
      .all<NavRow>(),
  ]);
  const byId = new Map(latest.results.map((r) => [r.mufap_id, toNav(r)]));
  return {
    funds: catalog.results.map((r) => ({
      mufapId: r.mufap_id,
      amc: r.amc,
      fundName: r.fund_name,
      category: r.category,
      sector: r.sector,
      inceptionDate: r.inception_date,
      latest: byId.get(r.mufap_id) ?? null,
    })),
  };
}

/** One fund's stored prices, oldest first (history starts the day the scraper started). */
export async function readFundHistory(
  db: FundDb,
  mufapId: string,
): Promise<FundHistoryResponse> {
  if (!/^\d{1,8}$/.test(mufapId)) throw new Error('Invalid fund id.');
  const rows = await db
    .prepare(
      'SELECT mufap_id,date,nav,offer,repurchase,fetched_at FROM fund_navs WHERE mufap_id=? ORDER BY date',
    )
    .bind(mufapId)
    .all<NavRow>();
  return { mufapId, navs: rows.results.map(toNav) };
}
