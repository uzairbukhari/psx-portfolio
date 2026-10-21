'use client';
// Key statistics card on the company page: two columns of label/value rows. Values come from public data only
// (live day quote, today's ticks, cached PSX company facts, payout announcements); a field with no data shows a dash.
import { useEffect, useMemo, useState } from 'react';
import type { PricePoint } from '@/lib/price-history';
import {
  formatStat,
  keyStats,
  type CompanyStats,
  type DayQuote,
} from '@/lib/company-stats';
import { faceValueFor } from '@/lib/face-values';
import { readJson } from '@/lib/safe-json';


export default function CompanyKeyStats({
  ticker,
  day,
  eod,
  intraday,
  company,
}: {
  ticker: string;
  /** The account's own company record: its face value wins over scraped evidence. */
  company: { faceValue?: number } | undefined;
  day: DayQuote | undefined;
  eod: PricePoint[];
  intraday: PricePoint[];
}) {
  const [loaded, setLoaded] = useState<{
    ticker: string;
    stats: CompanyStats | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/company-stats?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        const body = (await readJson(r)) as { stats?: CompanyStats };
        if (live)
          setLoaded({ ticker, stats: r.ok ? (body.stats ?? null) : null });
      })
      .catch(() => {
        if (live) setLoaded({ ticker, stats: null });
      });
    return () => {
      live = false;
    };
  }, [ticker]);
  const stats = loaded?.ticker === ticker ? loaded.stats : null;
  const { left, right } = useMemo(
    () =>
      keyStats({
        stats,
        day,
        eod,
        intraday,
        company,
        faceValueAt: faceValueFor,
        todayIso: new Date().toISOString().slice(0, 10),
      }),
    [stats, day, eod, intraday, company],
  );
  return (
    <section className="card company-keystats" aria-label="Key statistics">
      <span className="lbl">Key statistics</span>
      <div className="keystats-cols">
        {[left, right].map((col, i) => (
          <dl key={i}>
            {col.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="num">{formatStat(row)}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </section>
  );
}
