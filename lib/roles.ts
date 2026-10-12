import { env } from 'cloudflare:workers';

/** `tester` is a normal account with the permissions of `user`; it is only left out of usage analytics. */
export type Role = 'super_admin' | 'tester' | 'user';

export async function getUserRole(email: string): Promise<Role> {
  try {
    const row = await env.DB
      .prepare('SELECT role FROM user_roles WHERE email=?')
      .bind(email.toLowerCase())
      .first<{ role: string }>();
    return row?.role === 'super_admin' || row?.role === 'tester' ? row.role : 'user';
  } catch {
    return 'user';
  }
}

export function isSuperAdmin(role: Role): boolean {
  return role === 'super_admin';
}

/** Super admins and test accounts: their activity does not count as real usage. */
export function isInternal(role: Role): boolean {
  return role === 'super_admin' || role === 'tester';
}
