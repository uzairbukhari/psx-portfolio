import type { PayoutAnnouncement } from './psx-payouts.ts';

type Row = {
  ticker: string;
  book_closure_start: string;
  book_closure_end: string;
  announced_on: string;
  kind: PayoutAnnouncement['kind'];
  period: string;
  details: string;
  percent: number | null;
  per_share_rs: number | null;
};

/** Shared payout announcements (see scripts/psx-payout-scrape.mjs) for the given tickers. */
export async function readAnnouncements(
  db: D1Database,
  tickers: string[],
): Promise<PayoutAnnouncement[]> {
  const wanted = new Set(tickers);
  const rows = await db
    .prepare(
      `SELECT ticker,book_closure_start,book_closure_end,announced_on,kind,period,details,percent,per_share_rs
       FROM dividend_announcements ORDER BY book_closure_start DESC`,
    )
    .all<Row>();
  return rows.results
    .filter((r) => wanted.has(r.ticker))
    .map((r) => ({
      ticker: r.ticker,
      announcedOn: r.announced_on,
      period: r.period,
      details: r.details,
      kind: r.kind,
      percent: r.percent,
      perShareRs: r.per_share_rs,
      bookClosureStart: r.book_closure_start,
      bookClosureEnd: r.book_closure_end,
    }));
}
