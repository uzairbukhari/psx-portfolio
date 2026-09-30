/**
 * Fixed-window, per-user rate limits kept in the `rate_limits` table. Used for
 * actions that spend shared resources (forced PSX refreshes, on-demand GitHub
 * facts scrapes) so one account cannot exhaust them for everyone.
 */
export type RateWindow = { windowStart: string; count: number };
export type RateOptions = { windowMs: number; max: number };

export function rateDecision(
  row: RateWindow | null,
  now: Date,
  { windowMs, max }: RateOptions,
) {
  const start = Date.parse(row?.windowStart ?? '');
  const open = row && Number.isFinite(start) && now.getTime() - start < windowMs;
  if (!open)
    return {
      allowed: true,
      retryAfterMs: 0,
      next: { windowStart: now.toISOString(), count: 1 },
    };
  if (row.count >= max)
    return {
      allowed: false,
      retryAfterMs: start + windowMs - now.getTime(),
      next: row,
    };
  return {
    allowed: true,
    retryAfterMs: 0,
    next: { windowStart: row.windowStart, count: row.count + 1 },
  };
}

/** Records one use of `action` for `userId`; returns whether it was allowed. */
export async function takeRateLimit(
  db: D1Database,
  userId: string,
  action: string,
  options: RateOptions,
  now = new Date(),
) {
  const row = await db
    .prepare(
      'SELECT window_start AS windowStart, count FROM rate_limits WHERE user_id=? AND action=?',
    )
    .bind(userId, action)
    .first<RateWindow>();
  const decision = rateDecision(row, now, options);
  if (decision.allowed)
    await db
      .prepare(
        `INSERT INTO rate_limits (user_id,action,window_start,count) VALUES (?,?,?,?)
         ON CONFLICT(user_id,action) DO UPDATE SET window_start=excluded.window_start, count=excluded.count`,
      )
      .bind(userId, action, decision.next.windowStart, decision.next.count)
      .run();
  return decision;
}

export const waitText = (ms: number) => {
  const minutes = Math.ceil(ms / 60_000);
  return minutes >= 120
    ? `${Math.ceil(minutes / 60)} hours`
    : `${minutes} minute${minutes === 1 ? '' : 's'}`;
};
