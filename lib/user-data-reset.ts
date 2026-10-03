// "Clear my data": a user wipes their own ledger (the client saves a blank encrypted portfolio) and the
// server removes its remaining per-user rows. The account, sign-in and vault stay. Allowed on every environment, but
// only for the signed-in user and only with an explicit confirmation from the client.
import { UserError } from './user-error.ts';

export function assertClearConfirmed(confirm: unknown) {
  if (confirm !== true) throw new UserError('Confirm that you want to delete all your holdings data.', 400);
}

/**
 * Deletes what the server still holds for the user outside the encrypted vault: research jobs and events, and any
 * rows left by the pre-encryption versions (plaintext portfolio, AI reviews, Monthly Picks runs). The encrypted
 * ledger itself is cleared by the client, which saves a blank portfolio.
 */
export async function clearUserData(db: D1Database, userId: string) {
  await db.batch([
    db.prepare('DELETE FROM research_events WHERE job_id IN (SELECT id FROM research_jobs WHERE user_id=?)').bind(userId),
    db.prepare('DELETE FROM research_jobs WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM ai_reviews WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM recommendation_attempts WHERE recommendation_id IN (SELECT id FROM monthly_recommendations WHERE user_id=?)').bind(userId),
    db.prepare('DELETE FROM monthly_recommendations WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM portfolios WHERE user_id=?').bind(userId),
  ]);
}
