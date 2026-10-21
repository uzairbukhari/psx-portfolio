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
  // Only the asked-for tickers are read (the primary key starts with ticker), in chunks under D1's bound-parameter limit.
  const unique = [...new Set(tickers)];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const result = await db
      .prepare(
        `SELECT ticker,book_closure_start,book_closure_end,announced_on,kind,period,details,percent,per_share_rs
         FROM dividend_announcements WHERE ticker IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Row>();
    rows.push(...result.results);
  }
  return rows
    .sort((a, b) => (b.book_closure_start ?? '').localeCompare(a.book_closure_start ?? ''))
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
