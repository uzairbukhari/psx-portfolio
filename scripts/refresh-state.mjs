// Records per-company scrape progress in `refresh_requests` so the app can show queued / running /
// completed / failed and tell an empty successful fetch from a failed one (see lib/workflow-requests.ts).
import { d1 } from './d1-rest.mjs';

const ROWS_PER_STATEMENT = 11; // 9 bound values per row, 100-parameter limit

/** Marks tickers as running (creating the request row for a scheduled run that nobody queued). */
export async function markRunning(kind, tickers) {
  const now = new Date().toISOString();
  for (let i = 0; i < tickers.length; i += ROWS_PER_STATEMENT) {
    const chunk = tickers.slice(i, i + ROWS_PER_STATEMENT);
    await d1(
      `INSERT INTO refresh_requests (kind,ticker,status,requested_at,started_at,attempts)
       VALUES ${chunk.map(() => "(?,?, 'running', ?, ?, 1)").join(',')}
       ON CONFLICT(kind,ticker) DO UPDATE SET status='running', started_at=excluded.started_at`,
      chunk.flatMap((ticker) => [kind, ticker, now, now]),
    );
  }
}

/** results: [{ ticker, rows, coverageFrom, error }]; error set = failed, otherwise completed (rows may be 0). */
export async function markFinished(kind, results) {
  const now = new Date().toISOString();
  for (let i = 0; i < results.length; i += ROWS_PER_STATEMENT) {
    const chunk = results.slice(i, i + ROWS_PER_STATEMENT);
    await d1(
      `INSERT INTO refresh_requests (kind,ticker,status,requested_at,completed_at,rows_found,coverage_from,error,attempts)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,1)').join(',')}
       ON CONFLICT(kind,ticker) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at,
         rows_found=excluded.rows_found, coverage_from=excluded.coverage_from, error=excluded.error`,
      chunk.flatMap((r) => [
        kind, r.ticker, r.error ? 'failed' : 'completed', now, now,
        r.error ? null : r.rows, r.error ? null : (r.coverageFrom ?? null), r.error ? String(r.error).slice(0, 300) : null,
      ]),
    );
  }
}
