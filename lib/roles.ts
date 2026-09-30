import { env } from 'cloudflare:workers';

export type Role = 'super_admin' | 'user';

export async function getUserRole(email: string): Promise<Role> {
  try {
    const row = await env.DB
      .prepare('SELECT role FROM user_roles WHERE email=?')
      .bind(email.toLowerCase())
      .first<{ role: string }>();
    return row?.role === 'super_admin' ? 'super_admin' : 'user';
  } catch {
    return 'user';
  }
}

export function isSuperAdmin(role: Role): boolean {
  return role === 'super_admin';
}
