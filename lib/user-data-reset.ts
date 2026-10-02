// "Clear my data": a user wipes their own holdings, trades, dividends, quotes and Monthly Picks runs
// and starts over. The account, sign-in and AI usage record stay. Allowed on every environment, but
// only for the signed-in user and only with an explicit confirmation from the client.
import { UserError } from './user-error.ts';

export function assertClearConfirmed(confirm: unknown) {
  if (confirm !== true) throw new UserError('Confirm that you want to delete all your holdings data.', 400);
}

/** Deletes the user's portfolio (holdings, trades, dividends, splits, quotes, notifications) and Monthly Picks runs. */
export async function clearUserData(db: D1Database, userId: string) {
  await db.batch([
    db.prepare('DELETE FROM recommendation_attempts WHERE recommendation_id IN (SELECT id FROM monthly_recommendations WHERE user_id=?)').bind(userId),
    db.prepare('DELETE FROM monthly_recommendations WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM portfolios WHERE user_id=?').bind(userId),
  ]);
}
