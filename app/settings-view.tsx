'use client';

import { useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Cpu,
  Database,
  Download,
  KeyRound,
  LogOut,
  Receipt,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  REASONING_EFFORTS,
  RESEARCH_MODELS,
  type ResearchSettings,
} from '@/lib/portfolio';
import { useConfirm } from '@/components/confirm-dialog';
import SystemHealth from './system-health';
import { UserAvatar } from './user-avatar';
import { ImportPanel, UploadButton } from './settings-imports';
import type { ImportKind, ImportSummary } from '@/lib/import-detect';
import './settings.css';

type Usage = { inputTokens: number; outputTokens: number; costUsd: number };

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Section({
  id,
  icon,
  title,
  description,
  badge,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="set-card" data-section={id}>
      <header className="set-card-head">
        <span className="set-card-icon">{icon}</span>
        <div>
          <h2>
            {title}
            {badge && <em className="set-badge">{badge}</em>}
          </h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="set-card-body">{children}</div>
    </section>
  );
}

function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  return (
    <input
      type="number"
      className="set-input"
      min={min}
      max={max}
      step={step}
      key={value}
      defaultValue={value}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== value) onCommit(v);
      }}
    />
  );
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export default function SettingsView({
  name,
  email,
  picture,
  role,
  busy,
  usage,
  filerStatus,
  researchSettings: rs,
  onBack,
  onFilerStatus,
  onResearchSettings,
  onExport,
  onExportEncrypted,
  onClearLedger,
  onRestore,
  onImportFile,
  importSummary,
  dividendSync,
  security,
  initialSection,
}: {
  name: string | null;
  email: string;
  picture: string | null;
  role: 'super_admin' | 'user';
  busy: boolean;
  usage: Usage | null;
  filerStatus: '' | 'filer' | 'non-filer';
  researchSettings: ResearchSettings;
  onBack: () => void;
  onFilerStatus: (v: 'filer' | 'non-filer') => void;
  onResearchSettings: (patch: Partial<ResearchSettings>) => void;
  onExport: () => void;
  onExportEncrypted: () => void;
  /** Saves a blank, freshly encrypted portfolio from this device. */
  onClearLedger: () => Promise<void>;
  onRestore: (file: File) => void;
  /** Any import file; `expected` is set when the user picked a specific source card. */
  onImportFile: (file: File, expected?: ImportKind) => void;
  importSummary: ImportSummary;
  dividendSync?: ReactNode;
  /** The vault security card (lock, change password, recovery key). */
  security?: ReactNode;
  initialSection?: string;
}) {
  const isAdmin = role === 'super_admin';
  const [pendingRestore, setPendingRestore] = useState<File | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  async function clearData() {
    const ok = await confirm({
      title: 'Delete all your holdings data?',
      description:
        'This permanently deletes all your holdings, trades, dividends, saved prices, notifications and Monthly Picks runs. Your account stays. This cannot be undone. Export a backup first.',
      confirmLabel: 'Delete my data',
      destructive: true,
    });
    if (!ok) return;
    setClearBusy(true);
    setClearError(null);
    try {
      // The ledger exists only as ciphertext, so it is cleared here: a blank portfolio is encrypted and saved.
      await onClearLedger();
      // Then the server removes anything else it holds for the account (research jobs, legacy rows).
      const res = await fetch('/api/me/data', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not delete your data.');
      }
      window.location.href = '/';
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Could not delete your data.');
      setClearBusy(false);
    }
  }
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteReady = deleteConfirm.trim().toLowerCase() === email.toLowerCase();
  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirm.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not delete your account.');
      }
      window.location.href = '/';
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete your account.');
      setDeleteBusy(false);
    }
  }
  const [active, setActive] = useState(initialSection ?? 'account');
  const sections = [
    { id: 'account', label: 'Account', icon: UserRound },
    ...(security ? [{ id: 'security', label: 'Security', icon: KeyRound }] : []),
    { id: 'data', label: 'Data & imports', icon: Database },
    ...(dividendSync ? [{ id: 'sync-dividends', label: 'Sync dividends', icon: RefreshCw }] : []),
    ...(isAdmin ? [{ id: 'research', label: 'Research AI', icon: Cpu }, { id: 'health', label: 'System health', icon: Activity }] : []),
  ];
  const current = sections.some((x) => x.id === active) ? active : 'account';

  return (
    <div className="settings-shell">
      <button
        type="button"
        data-slot="link"
        className="back-link"
        onClick={onBack}
      >
        <ArrowLeft size={15} /> Back to dashboard
      </button>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Manage your account, tax status and portfolio data.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={current === id ? 'active' : ''}
              aria-current={current === id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                setActive(id);
                window.scrollTo({ top: 0 });
              }}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </a>
          ))}
        </nav>
        <div className="set-content">
          {current === 'account' && (
            <>
              <Section
                id="profile"
                icon={<UserRound size={18} />}
                title="Profile"
                description="The Google account you're signed in with."
              >
                <div className="profile-row">
                  <UserAvatar
                    name={name}
                    email={email}
                    picture={picture}
                    large
                  />
                  <div className="profile-text">
                    <strong>{name ?? 'Signed in'}</strong>
                    <span>{email}</span>
                  </div>
                  <span className={isAdmin ? 'role-pill admin' : 'role-pill'}>
                    <ShieldCheck size={13} aria-hidden="true" />
                    {isAdmin ? 'Super admin' : 'Member'}
                  </span>
                  <button
                    type="button"
                    className="secondary compact signout-link"
                    onClick={() => {
                      window.location.href = '/api/auth/logout';
                    }}
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              </Section>

              <Section
                id="tax"
                icon={<Receipt size={18} />}
                title="Tax status"
                description="Sets the rate used to estimate tax on gains and dividends in Reports."
              >
                <RadioGroup
                  className="option-cards"
                  value={filerStatus}
                  onValueChange={(v) =>
                    onFilerStatus(v as 'filer' | 'non-filer')
                  }
                >
                  {(
                    [
                      ['filer', 'Filer', '15%'],
                      ['non-filer', 'Non-filer', '30%'],
                    ] as const
                  ).map(([value, label, rate]) => (
                    <label
                      key={value}
                      htmlFor={`tax-${value}`}
                      className={
                        filerStatus === value
                          ? 'option-card selected'
                          : 'option-card'
                      }
                    >
                      <RadioGroupItem id={`tax-${value}`} value={value} />
                      <span>
                        <strong>{label}</strong>
                        <small>{rate} tax on gains and dividends</small>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {!filerStatus && (
                  <p className="set-hint">
                    Choose one to see after-tax figures in Reports.
                  </p>
                )}
                <ul className="set-note">
                  <li>
                    Capital gains are netted per July–June tax year before the
                    rate is applied.
                  </li>
                  <li>
                    Deductions you record (broker, NCCPL or CDC) are kept as
                    actual figures and never recalculated when you change this.
                  </li>
                  <li>
                    Real capital gains tax depends on the acquisition date and
                    current rules, so estimates are indicative, not your tax
                    liability.
                  </li>
                </ul>
              </Section>

              <Section
                id="usage"
                icon={<Zap size={18} />}
                title="AI usage"
                description="Tokens and estimated cost since usage tracking began."
              >
                <div className="stat-tiles">
                  {(
                    [
                      [
                        'Input tokens',
                        usage && usage.inputTokens.toLocaleString(),
                      ],
                      [
                        'Output tokens',
                        usage && usage.outputTokens.toLocaleString(),
                      ],
                      ['Estimated cost', usage && usd.format(usage.costUsd)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="stat-tile">
                      <small>{label}</small>
                      {value ? (
                        <strong>{value}</strong>
                      ) : (
                        <Skeleton className="h-7 w-24" />
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {current === 'security' && security && (
            <Section
              id="security"
              icon={<KeyRound size={18} />}
              title="Security"
              description="Your vault password, recovery key and locking."
            >
              {security}
            </Section>
          )}

          {current === 'data' && (
            <Section
              id="data"
              icon={<Database size={18} />}
              title="Data & imports"
              description="Back up your ledger, or bring in history from your broker and CDC."
            >
              <ImportPanel busy={busy} summary={importSummary} onImportFile={onImportFile} />
              <h3 className="set-group-title">Backup &amp; export</h3>
              <div className="set-split">
                <div className="set-tile">
                  <strong>Encrypted backup</strong>
                  <span>Opens only with your vault password or recovery key, so it is safe to store anywhere.</span>
                  <button className="secondary compact" onClick={onExportEncrypted}>
                    <Download size={14} /> Export encrypted backup
                  </button>
                </div>
                <div className="set-tile">
                  <strong>Readable export</strong>
                  <span>Not encrypted: anyone who gets this file can read every holding and trade. Keep it private and delete it when done.</span>
                  <button className="secondary compact" onClick={onExport}>
                    <Download size={14} /> Export readable file
                  </button>
                </div>
              </div>
              <details className="set-danger">
                <summary>Danger zone: restore, delete data, delete account</summary>
            <div className="danger-zone">
              <div className="set-row-text">
                <strong>Restore from backup</strong>
                <span>
                  Replaces your entire portfolio with the backup file (an encrypted backup, or a readable ledger file from an older version). Export a backup first.
                </span>
              </div>
              <UploadButton
                accept="application/json,.json"
                disabled={busy}
                label="Restore…"
                onFile={setPendingRestore}
              />
            </div>
            <div className="danger-zone">
              <div className="set-row-text">
                <strong>Delete my holdings data</strong>
                <span>
                  Deletes all your holdings, trades, dividends, saved prices, notifications and Monthly Picks runs so
                  you can start fresh. Your account stays. This cannot be undone. Export a backup first.
                </span>
                {clearError && <span role="alert">{clearError}</span>}
              </div>
              <button type="button" className="secondary compact" disabled={clearBusy} onClick={() => void clearData()}>
                {clearBusy ? 'Deleting…' : 'Delete data…'}
              </button>
            </div>
            <div className="danger-zone">
              <div className="set-row-text">
                <strong>Delete account</strong>
                <span>
                  Permanently deletes your portfolio, AI reviews and usage, research jobs and signed-in
                  phones. This cannot be undone. Export a backup first.
                </span>
              </div>
              <button type="button" className="secondary compact" onClick={() => setDeleting(true)}>
                Delete account…
              </button>
            </div>
              </details>
            </Section>
          )}

          {dividendSync && current === 'sync-dividends' && (
            <Section
              id="sync-dividends"
              icon={<RefreshCw size={18} />}
              title="Sync dividends"
              description="Backfill cash dividends from your whole holding history and approve them as received."
            >
              {dividendSync}
            </Section>
          )}

          {isAdmin && current === 'health' && (
            <Section
              id="health"
              icon={<Activity size={18} />}
              title="System health"
              badge="Super admin"
              description="Monthly Picks run processor, data freshness and recent scrape failures."
            >
              <SystemHealth />
            </Section>
          )}

          {isAdmin && current === 'research' && (
            <Section
              id="research"
              icon={<Cpu size={18} />}
              title="Research AI"
              badge="Super admin"
              description="Applies to research runs started after you save. Jobs already queued keep the settings they started with."
            >
              <Row label="AI model">
                <select
                  className="set-input"
                  value={rs.model}
                  onChange={(e) =>
                    onResearchSettings({
                      model: e.target.value as ResearchSettings['model'],
                    })
                  }
                >
                  {RESEARCH_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Reasoning effort">
                <select
                  className="set-input"
                  value={rs.reasoningEffort}
                  onChange={(e) =>
                    onResearchSettings({
                      reasoningEffort: e.target
                        .value as ResearchSettings['reasoningEffort'],
                    })
                  }
                >
                  {REASONING_EFFORTS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Budget per run" hint="US dollars, 0.05 to 5.">
                <NumberField
                  value={rs.budgetUsd}
                  min={0.05}
                  max={5}
                  step={0.05}
                  onCommit={(v) => onResearchSettings({ budgetUsd: v })}
                />
              </Row>
              <Row label="Max output tokens" hint="4,000 to 64,000.">
                <NumberField
                  value={rs.maxOutputTokens}
                  min={4000}
                  max={64000}
                  step={1000}
                  onCommit={(v) => onResearchSettings({ maxOutputTokens: v })}
                />
              </Row>
              <Row label="Self-correction attempts" hint="1 to 5.">
                <NumberField
                  value={rs.maxAttempts}
                  min={1}
                  max={5}
                  step={1}
                  onCommit={(v) => onResearchSettings({ maxAttempts: v })}
                />
              </Row>
            </Section>
          )}
        </div>
      </div>
      {confirmDialog}
      <AlertDialog
        open={!!pendingRestore}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRestore?.name} will replace everything in your current
              portfolio. Export a backup first if you might need it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingRestore) onRestore(pendingRestore);
                setPendingRestore(null);
              }}
            >
              Replace portfolio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleting}
        onOpenChange={(open) => {
          if (deleteBusy) return;
          setDeleting(open);
          if (!open) {
            setDeleteConfirm('');
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes everything stored for {email}: your portfolio and ledger, AI
              reviews, research jobs and signed-in phones. Type your email address to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="email"
            className="set-input"
            aria-label="Type your email address to confirm"
            placeholder={email}
            autoComplete="off"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          {deleteError && <p className="set-hint" role="alert">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteReady || deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                void deleteAccount();
              }}
            >
              {deleteBusy ? 'Deleting…' : 'Delete everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="muted settings-about">
        <b>About.</b> Plans are estimates. Actual execution prices, fees, taxes and corporate
        actions may differ. No orders are placed by this dashboard.
      </p>
    </div>
  );
}
