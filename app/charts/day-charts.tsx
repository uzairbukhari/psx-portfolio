'use client';

import { barOption, timeSeriesOption } from '@/lib/chart-kit';
import { EChart } from './echart';

type Day = { day: string };

/** A count per day as bars (admin console). `day` is an ISO date. */
export function DayBars<T extends Day>({
  rows,
  pick,
  name,
  className = 'usage-chart',
  dayText = (d) => d.slice(5),
  danger,
}: {
  rows: T[];
  pick: (row: T) => number;
  name: string;
  className?: string;
  dayText?: (day: string) => string;
  /** Errors are drawn in the danger colour. */
  danger?: boolean;
}) {
  return (
    <EChart
      className={className}
      label={`${name} per day, ${rows.length} days.`}
      build={(t) =>
        barOption(t, {
          cats: rows.map((r) => r.day),
          catTitle: dayText,
          series: [
            {
              name,
              data: rows.map(pick),
              color: danger ? t.danger : t.primary,
            },
          ],
          valueFormat: (n) => String(n),
          integer: true,
        })
      }
    />
  );
}

/** A count per day as a line (admin console). */
export function DayLine<T extends Day>({
  rows,
  pick,
  name,
  className = 'usage-chart',
  dayText = (d) => d.slice(5),
}: {
  rows: T[];
  pick: (row: T) => number;
  name: string;
  className?: string;
  dayText?: (day: string) => string;
}) {
  return (
    <EChart
      className={className}
      label={`${name} per day, ${rows.length} days.`}
      build={(t) =>
        timeSeriesOption(t, {
          name,
          data: rows.map((r) => ({ x: r.day, y: pick(r) })),
          area: true,
          includeZero: true,
          integer: true,
          zoom: false,
          valueFormat: (n) => String(n),
          dateLabel: (x) => dayText(String(x)),
        })
      }
    />
  );
}
