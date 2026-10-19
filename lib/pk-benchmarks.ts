// Public Pakistan benchmarks for the Insights comparison bar. Curated by hand and shipped with the app: nothing here
// is private and nothing is fetched. Figures are rounded and approximate (calendar-year average CPI inflation from
// PBS releases, SBP policy rate after each Monetary Policy Committee decision). Check them against pbs.gov.pk and
// sbp.org.pk when editing. Update `BENCHMARKS_AS_OF` whenever the tables change: after the last entry the last value
// is carried forward and the page says so.

/** Date the tables were last checked. */
export const BENCHMARKS_AS_OF = '2025-06-30';

/** Calendar year -> average year-on-year consumer price inflation, percent. */
export const CPI_YOY_BY_YEAR: readonly (readonly [number, number])[] = [
  [2015, 2.5],
  [2016, 3.8],
  [2017, 4.1],
  [2018, 3.9],
  [2019, 6.8],
  [2020, 10.7],
  [2021, 8.9],
  [2022, 12.1],
  [2023, 29.2],
  [2024, 12.6],
  [2025, 4.0],
];

/** Effective date -> SBP policy rate, percent. */
export const POLICY_RATE: readonly (readonly [string, number])[] = [
  ['2015-01-01', 8.5],
  ['2015-05-25', 7.0],
  ['2016-09-26', 5.75],
  ['2018-01-29', 6.0],
  ['2018-05-21', 6.5],
  ['2018-07-16', 7.5],
  ['2018-09-30', 8.5],
  ['2018-11-29', 10.0],
  ['2019-01-31', 10.75],
  ['2019-07-16', 13.25],
  ['2020-03-17', 12.5],
  ['2020-03-24', 11.0],
  ['2020-04-16', 9.0],
  ['2020-06-25', 7.0],
  ['2021-09-20', 7.25],
  ['2021-11-19', 8.75],
  ['2021-12-14', 9.75],
  ['2022-04-07', 12.25],
  ['2022-07-07', 15.0],
  ['2023-01-23', 17.0],
  ['2023-03-02', 20.0],
  ['2023-04-04', 21.0],
  ['2023-06-26', 22.0],
  ['2024-06-10', 20.5],
  ['2024-07-29', 19.5],
  ['2024-09-12', 17.5],
  ['2024-11-04', 15.0],
  ['2024-12-16', 13.0],
  ['2025-01-27', 12.0],
  ['2025-05-05', 11.0],
];

/** A savings account usually pays a few points under the policy rate. The comparison says it is an estimate. */
export const SAVINGS_SPREAD_POINTS = 3;
export const SAVINGS_FLOOR_PERCENT = 1;

/** Policy rate in force on a date (percent), or null before the table starts. */
export function policyRateOn(date: string): number | null {
  let rate: number | null = null;
  for (const [from, value] of POLICY_RATE) {
    if (from <= date) rate = value;
    else break;
  }
  return rate;
}

/** Estimated savings-account rate (percent) on a date. */
export function savingsRateOn(date: string): number | null {
  const policy = policyRateOn(date);
  return policy === null ? null : Math.max(SAVINGS_FLOOR_PERCENT, policy - SAVINGS_SPREAD_POINTS);
}

/** Inflation (percent a year) for the calendar year of a date; the last known year is carried forward. */
export function inflationOn(date: string): number | null {
  const year = Number(date.slice(0, 4));
  if (year < CPI_YOY_BY_YEAR[0][0]) return null;
  let value = CPI_YOY_BY_YEAR[0][1];
  for (const [y, v] of CPI_YOY_BY_YEAR) if (y <= year) value = v;
  return value;
}
