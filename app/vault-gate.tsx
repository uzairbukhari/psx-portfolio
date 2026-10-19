'use client';
// The only way in to the portfolio: signed in is not enough, the vault has to be unlocked with the vault password
// (or the recovery key). Everything decrypted lives in the VaultSession in this tab's memory; locking (button,
// 15 minutes of inactivity, sign-out) zeroes the key and unmounts the dashboard, which drops its state.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
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
import { MIN_PASSWORD_CHARS, VaultError, decodeRecoverySecret, setKdfRunner } from '@/lib/vault-crypto';
import { forgetTabKey, keepTabKey, recallTabKey } from '@/lib/vault-tab-keep';
import { browserTabKeepStore } from './vault-tab-store';
import { webVaultTransport } from './vault-transport';
import { deriveKey } from './kdf-client';
import { reportAccountState, track } from './analytics';
import './vault.css';

// Argon2id runs in a Worker thread in the browser, so unlocking never freezes the page.
setKdfRunner(deriveKey);

export const INACTIVITY_LOCK_MS = 15 * 60_000;

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; upgrade: boolean }
  | { kind: 'setup' }
  | { kind: 'recovery-key'; prepared: PreparedVault }
  | { kind: 'locked'; status: Extract<VaultStatus, { state: 'locked' }>; mode: 'password' | 'recover' | 'reset' }
  | { kind: 'unlocked'; session: VaultSession };

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

/** Passwords are scored by length and variety only, on this device. The meter is a hint, not a rule. */
function strengthOf(password: string): { score: number; label: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const raw = password.length >= MIN_PASSWORD_CHARS ? Math.min(4, Math.floor(password.length / 6) + (classes > 2 ? 1 : 0)) : Math.min(1, password.length ? 1 : 0);
  const score = password.length >= MIN_PASSWORD_CHARS ? Math.max(2, raw) : raw;
  return { score, label: ['', 'Too short', 'Okay', 'Good', 'Strong'][score] ?? '' };
}

function useStageIndex(busy: boolean, count: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!busy) return setI(0);
    const id = window.setInterval(() => setI((n) => Math.min(n + 1, count - 1)), 1800);
    return () => window.clearInterval(id);
  }, [busy, count]);
  return i;
}

const STAGES = ['Password checked on this device', 'Decrypting your ledger', 'Loading today’s prices'];

function useStage(busy: boolean, stages: string[]) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!busy) return setI(0);
    const id = window.setInterval(() => setI((n) => Math.min(n + 1, stages.length - 1)), 1500);
    return () => window.clearInterval(id);
  }, [busy, stages.length]);
  return stages[Math.min(i, stages.length - 1)];
}

function Shell({
  title,
  kicker,
  children,
  aside,
  avatar,
  step,
  wide,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  aside?: ReactNode;
  avatar?: ReactNode;
  step?: string;
  wide?: boolean;
}) {
  return (
    <main className="load-error vault-stage always-dark">
      <header className="vault-top">
        <div className="brand">
          <LogoMark size={32} />
          <Wordmark />
        </div>
        {step ? (
          <span className="vault-top-note">{step}</span>
        ) : (
          <span className="vault-top-note">
            Not you? <SignOut />
          </span>
        )}
      </header>
      <div className="vault-layout">
        <div className={`signin-card vault-card${avatar ? ' vault-card-center' : ''}${wide ? ' vault-card-wide' : ''}`}>
          {avatar}
          {kicker && <p className="vault-kicker">{kicker}</p>}
          <h2>{title}</h2>
          {children}
        </div>
        {aside && <div className="vault-aside">{aside}</div>}
      </div>
      <p className="vault-foot">
        <ShieldCheck size={14} aria-hidden="true" /> AES-256-GCM on this device · the vault locks after 15 minutes idle
      </p>
    </main>
  );
}

function maskEmail(email: string) {
  const [name = '', domain = ''] = email.split('@');
  if (name.length < 3) return email;
  return `${name[0]}${'•'.repeat(Math.min(7, name.length - 2))}${name.slice(-1)}@${domain}`;
}

function Avatar({ email, picture }: { email: string; picture?: string | null }) {
  return (
    <div className="vault-avatar" aria-hidden="true">
      <span>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" referrerPolicy="no-referrer" className="vault-avatar-img" />
        ) : (
          (email[0] ?? 'S').toUpperCase()
        )}
      </span>
      <i>
        <LockKeyhole size={15} />
      </i>
    </div>
  );
}

function SignOut() {
  return (
    <button type="button" className="signin-link vault-signout" onClick={() => void forgetTabKey(browserTabKeepStore()).finally(() => void (window.location.href = '/api/auth/logout'))}>
      Sign out
    </button>
  );
}

const lengthOk = (value: string) => [...value.normalize('NFKC')].length >= MIN_PASSWORD_CHARS;

export default function VaultGate({ email, name, picture, children }: { email: string; name?: string | null; picture?: string | null; children: (session: VaultSession, lock: () => void) => ReactNode }) {
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
      <main className="app-loading vault-stage always-dark" role="status" aria-live="polite">
        <div className="boot">
          <div className="boot-orb" aria-hidden="true">
            <i className="boot-ring" />
            <i className="boot-ring r2" />
            <span className="boot-core">
              <LogoMark size={40} />
            </span>
          </div>
          <div className="brand">
            <Wordmark />
          </div>
          <p className="boot-line">Checking your private vault…</p>
          <span className="boot-bar" aria-hidden="true">
            <i />
          </span>
          <p className="boot-note">
            <LockKeyhole size={13} aria-hidden="true" /> Decrypted only on this device
          </p>
        </div>
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
  return <Unlock status={view.status} mode={view.mode} setMode={(mode) => setView({ ...view, mode })} onOpen={open} onReset={() => lockNow()} email={email} name={name ?? null} picture={picture} />;
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
    <Shell title="Choose a vault password" kicker="Step 1 · password" step="Step 1 of 2">
      <p className="muted">
        Your holdings are encrypted on this device before they are saved, so nobody else, including whoever runs this app, can read them. Choose a vault password that is separate from your Google sign-in.
      </p>
      <form onSubmit={submit}>
        <label>
          Vault password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        </label>
        <div className="vault-meter" aria-live="polite">
          <div className="vault-meter-bar" data-score={strengthOf(password).score}>
            {[1, 2, 3, 4].map((n) => (
              <i key={n} data-on={strengthOf(password).score >= n ? '' : undefined} />
            ))}
          </div>
          <span>{password ? strengthOf(password).label : 'Strength'}</span>
        </div>
        <ul className="vault-checks">
          <li data-ok={password.length >= MIN_PASSWORD_CHARS ? '' : undefined}>At least {MIN_PASSWORD_CHARS} characters</li>
          <li data-ok={password && password === again ? '' : undefined}>Both passwords match</li>
        </ul>
        <p className="vault-hint muted">A passphrase of four or five random words works well, and a password manager can generate and store one.</p>
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
    <Shell title="Save your recovery key" kicker="Step 2 · recovery key" step="Step 2 of 2" wide>
      <p className="muted">If you forget your vault password, this key is the only way back in. We cannot recover it for you. Save it in a password manager or print it, and keep it away from this device’s backups.</p>
      <div className="vault-recovery" data-testid="recovery-key">{prepared.recoverySecret}</div>
      <div className="vault-blocks" aria-hidden="true">
        {prepared.recoverySecret.replace(/[^A-Za-z0-9]/g, '').match(/.{1,4}/g)?.map((block, i) => (
          <span key={i}>{block}</span>
        ))}
      </div>
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
        <button type="button" className="secondary compact" onClick={() => window.print()}>
          Print
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
  name,
  picture,
}: {
  status: Extract<VaultStatus, { state: 'locked' }>;
  mode: 'password' | 'recover' | 'reset';
  setMode: (mode: 'password' | 'recover' | 'reset') => void;
  onOpen: (session: VaultSession) => void;
  onReset: () => void;
  email: string;
  name: string | null;
  picture?: string | null;
}) {
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [again, setAgain] = useState('');
  const [typed, setTyped] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stageIndex = useStageIndex(busy, STAGES.length);
  const [show, setShow] = useState(false);
  const firstName = (name ?? '').split(' ')[0];
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
        <button type="button" className="signin-link vault-danger-link" onClick={() => setMode('reset')} disabled={busy}>
          Lost both? Erase the vault
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
    <Shell
      title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
      kicker={maskEmail(email)}
      avatar={<Avatar email={email} picture={picture} />}
      aside={
        <>
          {busy && (
            <section className="vault-sidecard" aria-live="polite">
              <p className="lbl">Unlocking</p>
              <h3>Opening your vault</h3>
              <ol className="vault-stages">
                {STAGES.map((label, n) => (
                  <li key={label} data-state={n < stageIndex ? 'done' : n === stageIndex ? 'active' : 'todo'}>
                    <span className="ck">{n < stageIndex ? <Check size={13} /> : n === stageIndex ? <Spinner className="size-3" /> : null}</span>
                    {label}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section className="vault-sidecard">
            <h3>Forgot your vault password?</h3>
            <p className="muted">Your recovery key opens the vault and lets you set a new password.</p>
            <button type="button" className="vault-row-btn" data-slot="row" onClick={() => setMode('recover')} disabled={busy}>
              <ShieldCheck size={18} /> Use my recovery key <ChevronRight size={16} />
            </button>
            <hr />
            <p className="muted small">Lost both?</p>
            <button type="button" className="vault-row-btn danger" data-slot="row" onClick={() => setMode('reset')} disabled={busy}>
              Erase my vault and start again <ChevronRight size={16} />
            </button>
          </section>
        </>
      }
    >
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
          <span className="vault-field">
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} autoFocus required />
            <button type="button" data-slot="eye" aria-label={show ? 'Hide password text' : 'Show password text'} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        <label className="vault-keep">
          <span>Keep me unlocked in this tab</span>
          <input type="checkbox" role="switch" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={busy} />
          <small>Reloading won’t ask again until you close the tab, lock, or go idle for 15 minutes. Don’t use this on a shared computer.</small>
        </label>
        {error && (
          <p role="alert" className="notice error vault-shake" key={error}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password}>
          {busy ? <Spinner className="size-4" /> : <LockKeyhole size={17} />} {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      <button type="button" className="signin-link" onClick={() => setMode('recover')} disabled={busy}>
        Forgot password?
      </button>
    </Shell>
  );
}
