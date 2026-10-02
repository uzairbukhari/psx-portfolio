// Staging-only "start as a fresh user" reset for the super admin's own data. The production Worker
// never runs it: the guard checks the Worker's APP_ENV, not anything the client sends.
import { UserError } from './user-error.ts';

export function assertResetAllowed(appEnv: string | undefined, isSuperAdmin: boolean, confirm: unknown) {
  if (appEnv !== 'staging') throw new UserError('Resetting data is only available on staging.', 403);
  if (!isSuperAdmin) throw new UserError('Not authorized.', 403);
  if (confirm !== 'RESET') throw new UserError('Type RESET to confirm.', 400);
}

/** Deletes the user's portfolio (holdings, trades, dividends, splits, quotes, notifications) and Monthly Picks runs. */
export async function resetUserData(db: D1Database, userId: string) {
  await db.batch([
    db.prepare('DELETE FROM recommendation_attempts WHERE recommendation_id IN (SELECT id FROM monthly_recommendations WHERE user_id=?)').bind(userId),
    db.prepare('DELETE FROM monthly_recommendations WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM portfolios WHERE user_id=?').bind(userId),
  ]);
}
