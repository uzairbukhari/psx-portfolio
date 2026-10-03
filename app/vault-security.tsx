'use client';
// Settings > Security: lock now, change the vault password, replace the recovery key; plus the dialog that opens an
// encrypted backup. Everything is derived and verified on this device; the server only ever receives new wrappers.
import { useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { TransportError, type VaultSession } from '@/lib/vault-client';
import { MIN_PASSWORD_CHARS, VaultError, decodeRecoverySecret } from '@/lib/vault-crypto';
import type { BackupPackage } from '@/lib/vault-backup';
import type { Portfolio } from '@/lib/portfolio';
import { openBackup } from '@/lib/vault-backup';

const text = (error: unknown) => (error instanceof VaultError || error instanceof TransportError || error instanceof Error ? error.message : 'Something went wrong. Try again.');
const sameKey = (a: string, b: string) => {
  try {
    const x = decodeRecoverySecret(a), y = decodeRecoverySecret(b);
    return x.length === y.length && x.every((byte, i) => byte === y[i]);
  } catch {
    return false;
  }
};

export function VaultSecurity({ session, onLock }: { session: VaultSession; onLock: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fresh, setFresh] = useState<{ recoverySecret: string; wrapper: { nonce: string; ct: string } } | null>(null);
  const [typed, setTyped] = useState('');

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (next !== again) return setMessage({ ok: false, text: 'The two new passwords do not match.' });
    setBusy(true);
    try {
      await session.changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setMessage({ ok: true, text: 'Vault password changed. Use the new password the next time you unlock.' });
    } catch (e) {
      setMessage({ ok: false, text: text(e) });
    } finally {
      setBusy(false);
    }
  }
  async function startRecovery() {
    setMessage(null);
    setBusy(true);
    try {
      setFresh(await session.prepareRecovery());
      setTyped('');
    } catch (e) {
      setMessage({ ok: false, text: text(e) });
    } finally {
      setBusy(false);
    }
  }
  async function commitRecovery() {
    if (!fresh) return;
    setBusy(true);
    try {
      await session.commitRecovery(fresh);
      setFresh(null);
      setMessage({ ok: true, text: 'New recovery key saved. The old one no longer works.' });
    } catch (e) {
      setMessage({ ok: false, text: text(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-vault-grid">
      <p className="set-hint">
        Your portfolio is encrypted on this device. The server stores only ciphertext, so no one else can read it, and no one can recover it for you if you lose both your vault password and recovery key.
      </p>
      <div>
        <button type="button" className="secondary compact" onClick={onLock}>
          <LockKeyhole size={14} /> Lock now
        </button>
        <p className="vault-hint muted">The vault also locks after 15 minutes without activity.</p>
      </div>
      <form onSubmit={changePassword}>
        <strong>Change vault password</strong>
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} required />
        </label>
        <label>
          New password (at least {MIN_PASSWORD_CHARS} characters)
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} required />
        </label>
        <label>
          Repeat new password
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy} required />
        </label>
        <button type="submit" className="secondary compact" disabled={busy || !current || !next}>
          {busy ? <Spinner className="size-4" /> : null} Change password
        </button>
        <p className="vault-hint muted">
          This re-protects the same encryption key with your new password. It does not undo access for anyone who already has your old password or a copy of your data.
        </p>
      </form>
      <div>
        <strong>Recovery key</strong>
        {fresh ? (
          <>
            <div className="vault-recovery">{fresh.recoverySecret}</div>
            <label>
              Type or paste the new key to confirm you saved it
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
            </label>
            <div className="vault-actions">
              <button type="button" className="secondary compact" disabled={busy || !sameKey(typed, fresh.recoverySecret)} onClick={() => void commitRecovery()}>
                <KeyRound size={14} /> Use this key
              </button>
              <button type="button" className="secondary compact" disabled={busy} onClick={() => setFresh(null)}>
                Cancel
              </button>
            </div>
            <p className="vault-hint muted">Your current recovery key keeps working until you press “Use this key”.</p>
          </>
        ) : (
          <div>
            <button type="button" className="secondary compact" disabled={busy} onClick={() => void startRecovery()}>
              <KeyRound size={14} /> Replace recovery key…
            </button>
            <p className="vault-hint muted">Generate a new recovery key if you lost or exposed the old one. You will confirm the new key before the old one stops working.</p>
          </div>
        )}
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'notice success' : 'notice error'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/** Opens an encrypted backup with ITS password or recovery key, then hands the decrypted ledger back to be re-encrypted into the current vault. */
export function EncryptedRestoreDialog({
  backup,
  onCancel,
  onRestore,
}: {
  backup: BackupPackage | null;
  onCancel: () => void;
  onRestore: (portfolio: Portfolio) => Promise<void>;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!backup) return;
    setBusy(true);
    setError('');
    try {
      const portfolio = await openBackup(backup, useRecovery ? { recovery: secret } : { password: secret });
      await onRestore(portfolio);
      setSecret('');
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!backup} onOpenChange={(open) => !open && !busy && (setSecret(''), onCancel())}>
      <DialogContent className="form-dialog">
        <DialogTitle>Restore encrypted backup</DialogTitle>
        <DialogDescription>
          Enter the vault password or recovery key this backup was made with. It is decrypted on this device and re-encrypted into your current vault; your portfolio is replaced.
        </DialogDescription>
        <form onSubmit={submit}>
          <label>
            {useRecovery ? 'Backup recovery key' : 'Backup vault password'}
            <input type={useRecovery ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} required />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={busy || !secret}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => (setUseRecovery(!useRecovery), setSecret(''), setError(''))}>
              {useRecovery ? 'Use password' : 'Use recovery key'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
