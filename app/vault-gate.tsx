'use client';
// The only way in to the portfolio: signed in is not enough, the vault has to be unlocked with the vault password
// (or the recovery key). Everything decrypted lives in the VaultSession in this tab's memory; locking (button,
// 15 minutes of inactivity, sign-out) zeroes the key and unmounts the dashboard, which drops its state.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import { Spinner } from '@/components/ui/spinner';
import {
  TransportError,
  loadVaultStatus,
  prepareVault,
  recoverWithKey,
  openWithKey,
  unlockVault,
  type PreparedVault,
  type VaultSession,
  type VaultStatus,
} from '@/lib/vault-client';
import { MIN_PASSWORD_CHARS, VaultError, decodeRecoverySecret } from '@/lib/vault-crypto';
import { forgetTabKey, keepTabKey, recallTabKey } from '@/lib/vault-tab-keep';
import { browserTabKeepStore } from './vault-tab-store';
import { webVaultTransport } from './vault-transport';
import { reportAccountState, track } from './analytics';
import './vault.css';

export const INACTIVITY_LOCK_MS = 15 * 60_000;

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; upgrade: boolean }
  | { kind: 'setup' }
  | { kind: 'recovery-key'; prepared: PreparedVault }
  | { kind: 'locked'; status: Extract<VaultStatus, { state: 'locked' }>; mode: 'password' | 'recover' | 'reset' }
  | { kind: 'unlocked'; session: VaultSession };

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="load-error">
      <div className="signin-card vault-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <LogoMark size={26} />
          <Wordmark />
        </div>
        <span className="signin-mark">
          <LockKeyhole size={22} />
        </span>
        <h2>{title}</h2>
        {children}
      </div>
    </main>
  );
}

function SignOut() {
  return (
    <button type="button" className="signin-link" onClick={() => void forgetTabKey(browserTabKeepStore()).finally(() => void (window.location.href = '/api/auth/logout'))}>
      Sign out
    </button>
  );
}

const lengthOk = (value: string) => [...value.normalize('NFKC')].length >= MIN_PASSWORD_CHARS;

export default function VaultGate({ email, children }: { email: string; children: (session: VaultSession, lock: () => void) => ReactNode }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const sessionRef = useRef<VaultSession | null>(null);

  const lockNow = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.lock();
    await forgetTabKey(browserTabKeepStore());
    // Re-read the (ciphertext) vault state so the unlock screen is current; never reuses decrypted state.
    try {
      const status = await loadVaultStatus(webVaultTransport);
      setView(status.state === 'none' ? { kind: 'setup' } : { kind: 'locked', status, mode: 'password' });
    } catch (e) {
      setView({ kind: 'error', message: message(e), upgrade: e instanceof TransportError && e.status === 426 });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setView({ kind: 'loading' });
    loadVaultStatus(webVaultTransport)
      .then(async (status) => {
        if (!alive) return;
        void reportAccountState(status.state !== 'none');
        if (status.state === 'none') return setView({ kind: 'setup' });
        // Opt-in "stay unlocked in this tab": a reload reopens the vault without the password.
        const store = browserTabKeepStore();
        const key = await recallTabKey(store, email, status.vault.vaultId);
        if (key) {
          try {
            const session = await openWithKey(webVaultTransport, status, key);
            if (!alive) return session.lock();
            sessionRef.current = session;
            return setView({ kind: 'unlocked', session });
          } catch {
            await forgetTabKey(store);
          }
        }
        if (alive) setView({ kind: 'locked', status, mode: 'password' });
      })
      .catch((e) => alive && setView({ kind: 'error', message: message(e), upgrade: e instanceof TransportError && e.status === 426 }));
    return () => {
      alive = false;
      // Signed-in account changed or the page unmounted: nothing decrypted may outlive it.
      sessionRef.current?.lock();
      sessionRef.current = null;
    };
  }, [email]);

  // Lock after 15 minutes without input, and on pagehide so a restored tab never reappears unlocked.
  const unlocked = view.kind === 'unlocked';
  useEffect(() => {
    if (!unlocked) return;
    let timer = setTimeout(() => void lockNow(), INACTIVITY_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void lockNow(), INACTIVITY_LOCK_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, reset, { passive: true });
    const onHide = (event: PageTransitionEvent) => {
      if (event.persisted) void lockNow();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, reset);
      window.removeEventListener('pagehide', onHide);
    };
  }, [unlocked, lockNow]);

  const open = (session: VaultSession) => {
    sessionRef.current = session;
    setView({ kind: 'unlocked', session });
  };

  if (view.kind === 'unlocked') return <>{children(view.session, () => void lockNow())}</>;
  if (view.kind === 'loading')
    return (
      <main className="app-loading">
        <div className="brand">
          <LogoMark size={28} />
          <Wordmark />
        </div>
        <Spinner className="size-6" />
        <p className="muted">Checking your private vault…</p>
      </main>
    );
  if (view.kind === 'error')
    return (
      <Shell title={view.upgrade ? 'Reload to update' : 'We couldn’t open your vault'}>
        <p role="alert" className="notice error">
          {view.upgrade ? 'This page is out of date. Reload it to get the version that supports your encrypted portfolio.' : view.message}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          {view.upgrade ? 'Reload' : 'Try again'}
        </button>
        <SignOut />
      </Shell>
    );
  if (view.kind === 'setup') return <Setup onPrepared={(prepared) => setView({ kind: 'recovery-key', prepared })} />;
  if (view.kind === 'recovery-key')
    return <RecoveryKey prepared={view.prepared} onDone={open} onBack={() => (view.prepared.discard(), setView({ kind: 'setup' }))} />;
  return <Unlock status={view.status} mode={view.mode} setMode={(mode) => setView({ ...view, mode })} onOpen={open} onReset={() => lockNow()} email={email} />;
}

function Setup({ onPrepared }: { onPrepared: (prepared: PreparedVault) => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== again) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      onPrepared(await prepareVault(webVaultTransport, password));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <Shell title="Create your private vault">
      <p className="muted">
        Your holdings are encrypted on this device before they are saved, so nobody else, including whoever runs this app, can read them. Choose a vault password that is separate from your Google sign-in.
      </p>
      <form onSubmit={submit}>
        <label>
          Vault password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        </label>
        <p className="vault-hint muted">At least {MIN_PASSWORD_CHARS} characters. A passphrase of four or five random words works well, and a password manager can generate and store one.</p>
        <label>
          Repeat password
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy} required />
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !lengthOk(password)}>
          <ShieldCheck size={16} /> {busy ? 'Creating keys…' : 'Continue'}
        </button>
        {busy && <p className="vault-progress"><Spinner className="size-4" /> Deriving your key. This takes a few seconds on purpose.</p>}
      </form>
      <p className="vault-warning muted">There is no way for anyone to reset this password for you. Next you will get a recovery key; if you lose both, your data cannot be recovered.</p>
      <SignOut />
    </Shell>
  );
}

function RecoveryKey({ prepared, onDone, onBack }: { prepared: PreparedVault; onDone: (session: VaultSession) => void; onBack: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const matches = (() => {
    try {
      const a = decodeRecoverySecret(typed);
      const b = decodeRecoverySecret(prepared.recoverySecret);
      return a.length === b.length && a.every((byte, i) => byte === b[i]);
    } catch {
      return false;
    }
  })();
  function save() {
    const url = URL.createObjectURL(
      new Blob([`Sipwise recovery key\n\n${prepared.recoverySecret}\n\nKeep this somewhere safe and private. Anyone with it and access to your encrypted data can open your portfolio. If you lose both this key and your vault password, your data cannot be recovered.\n`], { type: 'text/plain' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sipwise-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function finish() {
    setBusy(true);
    setError('');
    try {
      const session = await prepared.finish();
      track('vault_created');
      onDone(session);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <Shell title="Save your recovery key">
      <p className="muted">If you forget your vault password, this key is the only way back in. We cannot recover it for you. Save it in a password manager or print it, and keep it away from this device’s backups.</p>
      <div className="vault-recovery" data-testid="recovery-key">{prepared.recoverySecret}</div>
      <div className="vault-actions">
        <button
          type="button"
          className="secondary compact"
          onClick={() => void navigator.clipboard?.writeText(prepared.recoverySecret).then(() => setCopied(true), () => setCopied(false))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="secondary compact" onClick={save}>
          Download
        </button>
      </div>
      <label>
        Type or paste the key to confirm you saved it
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} />
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button type="button" disabled={!matches || busy} onClick={() => void finish()}>
        <KeyRound size={16} /> {busy ? 'Creating your vault…' : 'I saved it, create my vault'}
      </button>
      <button type="button" className="signin-link" onClick={onBack} disabled={busy}>
        Back
      </button>
    </Shell>
  );
}

function Unlock({
  status,
  mode,
  setMode,
  onOpen,
  onReset,
  email,
}: {
  status: Extract<VaultStatus, { state: 'locked' }>;
  mode: 'password' | 'recover' | 'reset';
  setMode: (mode: 'password' | 'recover' | 'reset') => void;
  onOpen: (session: VaultSession) => void;
  onReset: () => void;
  email: string;
}) {
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [again, setAgain] = useState('');
  const [typed, setTyped] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(work: () => Promise<VaultSession | void>) {
    setBusy(true);
    setError('');
    try {
      const session = await work();
      if (session) onOpen(session);
    } catch (e) {
      setError(e instanceof VaultError || e instanceof TransportError ? e.message : message(e));
      setBusy(false);
    }
  }
  if (mode === 'recover')
    return (
      <Shell title="Reset your vault password">
        <p className="muted">Enter your recovery key and choose a new vault password. Your portfolio stays as it is.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== again) return setError('The two passwords do not match.');
            void run(async () => {
              const session = await recoverWithKey(webVaultTransport, status, recovery, password);
              track('vault_recovered');
              return session;
            });
          }}
        >
          <label>
            Recovery key
            <input value={recovery} onChange={(e) => setRecovery(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} required />
          </label>
          <label>
            New vault password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
          </label>
          <label>
            Repeat new password
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy} required />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !lengthOk(password) || !recovery.trim()}>
            {busy ? 'Working…' : 'Reset password and open'}
          </button>
        </form>
        <button type="button" className="signin-link" onClick={() => setMode('password')} disabled={busy}>
          Back
        </button>
      </Shell>
    );
  if (mode === 'reset')
    return (
      <Shell title="Erase this vault">
        <p role="alert" className="notice error">
          If you have lost both your vault password and your recovery key, the data cannot be recovered. You can erase it and start with an empty portfolio. This permanently deletes everything saved for {email}.
        </p>
        <label>
          Type ERASE to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} />
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button type="button" disabled={busy || typed.trim() !== 'ERASE'} onClick={() => void run(async () => { await webVaultTransport.deleteVault(); onReset(); })}>
          {busy ? 'Erasing…' : 'Erase vault and start over'}
        </button>
        <button type="button" className="signin-link" onClick={() => setMode('password')} disabled={busy}>
          Back
        </button>
      </Shell>
    );
  return (
    <Shell title="Unlock your vault">
      <p className="muted">Your portfolio is encrypted. Enter your vault password to open it. This is separate from your Google sign-in.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const session = await unlockVault(webVaultTransport, status, { password });
            if (keep) {
              const key = session.exportKey();
              try { await keepTabKey(browserTabKeepStore(), email, status.vault.vaultId, key); } finally { key.fill(0); }
            }
            track('vault_unlocked', { method: 'password' });
            return session;
          });
        }}
      >
        <label>
          Vault password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} autoFocus required />
        </label>
        <label className="vault-keep">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={busy} />
          <span>Keep me unlocked in this tab. Reloading won’t ask again until I close the tab, lock, or go idle for 15 minutes. Don’t use this on a shared computer.</span>
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password}>
          <LockKeyhole size={16} /> {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {busy && <p className="vault-progress"><Spinner className="size-4" /> Deriving your key. This takes a few seconds.</p>}
      </form>
      <div className="vault-links">
        <button type="button" className="signin-link" onClick={() => setMode('recover')} disabled={busy}>
          Forgot password? Use your recovery key
        </button>
        <button type="button" className="signin-link" onClick={() => setMode('reset')} disabled={busy}>
          Lost both? Erase the vault
        </button>
        <SignOut />
      </div>
      <p className="vault-lock-note">The vault locks after 15 minutes without activity.</p>
    </Shell>
  );
}
