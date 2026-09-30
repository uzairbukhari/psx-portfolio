'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Cpu,
  Database,
  Download,
  LogOut,
  Receipt,
  ShieldCheck,
  Upload,
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
import { UserAvatar } from './user-avatar';
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

function UploadButton({
  accept,
  onFile,
  disabled,
  label = 'Choose file',
}: {
  accept: string;
  onFile: (file: File) => void;
  disabled: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="secondary compact"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} /> {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
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
  onRestore,
  onImportCdc,
  onImportFinqalab,
  onImportAhl,
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
  onRestore: (file: File) => void;
  onImportCdc: (file: File) => void;
  onImportFinqalab: (file: File) => void;
  onImportAhl: (file: File) => void;
}) {
  const isAdmin = role === 'super_admin';
  const [pendingRestore, setPendingRestore] = useState<File | null>(null);
  const [active, setActive] = useState('profile');
  const sections = [
    { id: 'profile', label: 'Profile', icon: UserRound },
    { id: 'tax', label: 'Tax', icon: Receipt },
    { id: 'usage', label: 'AI usage', icon: Zap },
    { id: 'data', label: 'Data & imports', icon: Database },
    ...(isAdmin ? [{ id: 'research', label: 'Research AI', icon: Cpu }] : []),
  ];

  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>('[data-section]'),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive((visible[0].target as HTMLElement).id);
      },
      { rootMargin: '-90px 0px -60% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isAdmin]);

  return (
    <div className="settings-shell">
      <button type="button" data-slot="link" className="back-link" onClick={onBack}>
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
              className={active === id ? 'active' : ''}
              aria-current={active === id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                setActive(id);
                document
                  .getElementById(id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </a>
          ))}
        </nav>
        <div className="set-content">
          <Section
            id="profile"
            icon={<UserRound size={18} />}
            title="Profile"
            description="The Google account you're signed in with."
          >
            <div className="profile-row">
              <UserAvatar name={name} email={email} picture={picture} large />
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
            description="Sets the rate used for capital gains and manually entered dividends in Reports."
          >
            <RadioGroup
              className="option-cards"
              value={filerStatus}
              onValueChange={(v) => onFilerStatus(v as 'filer' | 'non-filer')}
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
                  className={filerStatus === value ? 'option-card selected' : 'option-card'}
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
              <p className="set-hint">Choose one to see after-tax figures in Reports.</p>
            )}
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
                  ['Input tokens', usage && usage.inputTokens.toLocaleString()],
                  ['Output tokens', usage && usage.outputTokens.toLocaleString()],
                  ['Estimated cost', usage && usd.format(usage.costUsd)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="stat-tile">
                  <small>{label}</small>
                  {value ? <strong>{value}</strong> : <Skeleton className="h-7 w-24" />}
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="data"
            icon={<Database size={18} />}
            title="Data & imports"
            description="Back up your ledger, or bring in history from your broker and CDC."
          >
            <Row
              label="CDC dividends"
              hint="CDC Access export (JSON). Only Paid rows are imported; bank and personal fields are never read."
            >
              <UploadButton accept="application/json,.json" disabled={busy} onFile={onImportCdc} />
            </Row>
            <Row
              label="Finqalab trades"
              hint="Periodic Trade Details Report (PDF). Re-uploading or overlapping reports won't duplicate trades."
            >
              <UploadButton accept="application/pdf,.pdf" disabled={busy} onFile={onImportFinqalab} />
            </Row>
            <Row
              label="AHL trades"
              hint="Trade history (JSON). Fees are rebuilt from gross rate and net amount; overlapping files are deduplicated."
            >
              <UploadButton accept="application/json,.json" disabled={busy} onFile={onImportAhl} />
            </Row>
            <Row label="Backup" hint="Download your whole ledger as a JSON file.">
              <button className="secondary compact" onClick={onExport}>
                <Download size={14} /> Export backup
              </button>
            </Row>
            <div className="danger-zone">
              <div className="set-row-text">
                <strong>Restore from backup</strong>
                <span>
                  Replaces your entire portfolio with the backup file. Export a backup first.
                </span>
              </div>
              <UploadButton
                accept="application/json,.json"
                disabled={busy}
                label="Restore…"
                onFile={setPendingRestore}
              />
            </div>
          </Section>

          {isAdmin && (
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
                    onResearchSettings({ model: e.target.value as ResearchSettings['model'] })
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
                      reasoningEffort: e.target.value as ResearchSettings['reasoningEffort'],
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
              {pendingRestore?.name} will replace everything in your current portfolio. Export a
              backup first if you might need it.
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
    </div>
  );
}
