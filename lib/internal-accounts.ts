import { userKey } from './analytics-store.ts';
import {
  checkRemove, checkSet, cleanNote, normalizeEmail, type InternalAccount, type InternalRole, type SetRequest,
} from './internal-accounts-rules.ts';
import { UserError } from './user-error.ts';

// D1 side of the admin console Accounts page: the list of internal accounts (super admins and test accounts) kept in
// `user_roles`. Internal accounts are left out of usage analytics when the reports are read.

export type InternalAccountRow = InternalAccount & { addedBy: string | null; createdAt: string; lastSeenAt: string | null };

export async function listInternalAccounts(db: D1Database): Promise<InternalAccountRow[]> {
  const { results } = await db.prepare(
    `SELECT r.email AS email, r.role AS role, r.note AS note, r.added_by AS addedBy, r.created_at AS createdAt, u.last_seen_at AS lastSeenAt
     FROM user_roles r LEFT JOIN app_users u ON lower(u.email)=lower(r.email)
     WHERE r.role IN ('super_admin','tester') ORDER BY r.role, r.email`,
  ).all<InternalAccountRow>();
  return results;
}

/** The analytics user keys of every internal account, used to leave their past events out of reports. */
export async function internalUserKeys(db: D1Database, secret: string): Promise<string[]> {
  if (!secret) return []; // no signing secret (local dev): keys cannot be computed, events still carry is_admin
  const { results } = await db.prepare("SELECT email FROM user_roles WHERE role IN ('super_admin','tester') LIMIT 200").all<{ email: string }>();
  return Promise.all(results.map((r) => userKey(r.email, secret)));
}

async function log(db: D1Database, actor: string, action: string, target: string, result: string) {
  await db.prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
    .bind(new Date().toISOString(), actor, action, target, result).run();
}

export async function setInternalAccount(db: D1Database, actor: string, req: SetRequest): Promise<void> {
  const existing = await listInternalAccounts(db);
  const problem = checkSet(existing, actor, req);
  if (problem) throw new UserError(problem, 400);
  const email = normalizeEmail(req.email)!;
  const role = req.role as InternalRole;
  const had = existing.find((a) => a.email === email);
  await db.prepare(
    `INSERT INTO user_roles (email,role,created_at,note,added_by) VALUES (?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET role=excluded.role, note=excluded.note`,
  ).bind(email, role, new Date().toISOString(), cleanNote(req.note), actor.toLowerCase()).run();
  await log(db, actor, had ? 'account_role_changed' : 'account_added', email, role);
}

export async function removeInternalAccount(db: D1Database, actor: string, emailValue: unknown): Promise<void> {
  const existing = await listInternalAccounts(db);
  const problem = checkRemove(existing, actor, emailValue);
  if (problem) throw new UserError(problem, 400);
  const email = normalizeEmail(emailValue)!;
  await db.prepare("DELETE FROM user_roles WHERE email=? AND role IN ('super_admin','tester')").bind(email).run();
  await log(db, actor, 'account_removed', email, 'user');
}
