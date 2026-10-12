'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { InternalAccountRow } from '@/lib/internal-accounts';
import { readJson } from '@/lib/safe-json';

type Role = 'super_admin' | 'tester';
const ROLE_LABEL: Record<Role, string> = { super_admin: 'Super admin', tester: 'Test account' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'never');

/** Internal accounts (GET/POST/DELETE /api/admin/accounts): super admins and test accounts, left out of usage analytics. */
export default function AdminAccounts({ email: me }: { email: string }) {
  const [accounts, setAccounts] = useState<InternalAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tester');
  const [note, setNote] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [removing, setRemoving] = useState<InternalAccountRow | null>(null);

  const call = useCallback(async (init?: RequestInit, query = '') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts${query}`, { cache: 'no-store', ...init });
      const body = (await readJson(res)) as { accounts?: InternalAccountRow[]; error?: string };
      if (!res.ok || !body.accounts) throw new Error(body.error ?? 'Could not load accounts.');
      setAccounts(body.accounts);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load accounts.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void call(), 0);
    return () => window.clearTimeout(timer);
  }, [call]);

  const add = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const ok = await call({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, note, confirmEmail }),
    });
    if (ok) { setEmail(''); setNote(''); setConfirmEmail(''); }
  };

  if (!accounts) return error ? <p role="alert" className="notice error">{error}</p> : <p className="muted">Loading…</p>;

  return (
    <div>
      <form className="admin-form" onSubmit={(e) => void add(e)}>
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
        </label>
        <label>Type
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="tester">Test account</option>
            <option value="super_admin">Super admin</option>
          </select>
        </label>
        <label>Note (optional)
          <input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder="Android test phone" />
        </label>
        <button type="submit" className="primary compact" disabled={busy || !email.trim()}>Add</button>
        {role === 'super_admin' && (
          <label style={{ gridColumn: '1 / -1' }}>Type the email again to confirm a new super admin
            <input type="email" required value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
          </label>
        )}
      </form>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Email</th><th>Type</th><th>Note</th><th>Last seen</th><th>Added by</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.email}>
                <td>{a.email}{a.email === me && <span className="set-badge"> You</span>}</td>
                <td>{ROLE_LABEL[a.role]}</td>
                <td>{a.note ?? '—'}</td>
                <td>{day(a.lastSeenAt)}</td>
                <td>{a.addedBy ?? '—'}</td>
                <td>
                  <button type="button" className="secondary compact" disabled={busy || (a.role === 'super_admin' && a.email === me)} onClick={() => setRemoving(a)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Test accounts work like any account but never count in usage analytics. Their errors still reach the audit log, tagged Internal.
        Removing an account makes it a normal user again; its past activity then counts.
      </p>
      <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.role === 'super_admin'
                ? 'This account loses super admin access.'
                : 'This account becomes a normal user and its activity counts in usage analytics again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const a = removing; setRemoving(null); if (a) void call({ method: 'DELETE' }, `?email=${encodeURIComponent(a.email)}`); }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
