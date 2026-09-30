// Exit policy shared by the GitHub Actions PSX scrapers: an empty ticker list is
// a successful no-op, and a run fails once more than 20% of tickers fail, so a
// PSX outage or parser break surfaces instead of hiding behind a few successes.
export const MAX_FAILED_SHARE = 0.2;

export function scrapeExitCode(total, failed) {
  if (!total) return 0;
  return failed / total > MAX_FAILED_SHARE ? 1 : 0;
}
