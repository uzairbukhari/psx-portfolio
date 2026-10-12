// Rules for the internal-accounts list (super admins and test accounts) on the admin console Accounts page. Pure, so
// the server route and the tests share them.

export type InternalRole = 'super_admin' | 'tester';
export type InternalAccount = { email: string; role: InternalRole; note: string | null };

export const INTERNAL_ROLES: readonly InternalRole[] = ['super_admin', 'tester'];
export const NOTE_MAX = 80;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function cleanNote(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX) : '';
  return text || null;
}

export type SetRequest = { email: unknown; role: unknown; note?: unknown; confirmEmail?: unknown };

/** Returns an error message for an add or role change that must be refused, or null when it is allowed. */
export function checkSet(existing: InternalAccount[], actor: string, req: SetRequest): string | null {
  const email = normalizeEmail(req.email);
  if (!email) return 'Enter a valid email address.';
  if (!INTERNAL_ROLES.includes(req.role as InternalRole)) return 'Choose super admin or test account.';
  if (req.role === 'super_admin' && normalizeEmail(req.confirmEmail) !== email) return 'Type the email again to confirm a new super admin.';
  const current = existing.find((a) => a.email === email);
  if (current?.role === 'super_admin' && req.role !== 'super_admin') {
    if (email === normalizeEmail(actor)) return 'You cannot remove your own super admin role.';
    if (existing.filter((a) => a.role === 'super_admin').length <= 1) return 'There must always be at least one super admin.';
  }
  return null;
}

/** Returns an error message for a removal that must be refused, or null when it is allowed. */
export function checkRemove(existing: InternalAccount[], actor: string, emailValue: unknown): string | null {
  const email = normalizeEmail(emailValue);
  if (!email) return 'Enter a valid email address.';
  const current = existing.find((a) => a.email === email);
  if (!current) return 'That account is not in the list.';
  if (current.role === 'super_admin') {
    if (email === normalizeEmail(actor)) return 'You cannot remove your own super admin role.';
    if (existing.filter((a) => a.role === 'super_admin').length <= 1) return 'There must always be at least one super admin.';
  }
  return null;
}
