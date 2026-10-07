'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { blankPortfolio } from '@/lib/portfolio';
import {
  ALL_PORTFOLIOS,
  normalizeAccount,
  portfolioName,
  removePortfolio,
  assertCanAddPortfolio,
  MAX_PORTFOLIOS,
  renamePortfolio,
  setPortfolioLocked,
  assertPortfolioWritable,
  type PortfolioAccount,
  type PortfolioTarget,
} from '@/lib/portfolio-account';
import type { VaultSession } from '@/lib/vault-client';
import type { ImportKind } from '@/lib/import-detect';
import { parseBackup } from '@/lib/vault-backup';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { EncryptedRestoreDialog } from './vault-security';

export type ImportRequest = {
  file: File;
  expected?: ImportKind;
  token: string;
  restore?: boolean;
};
export type WorkspaceControls = {
  target: PortfolioTarget;
  selected: string;
  account: PortfolioAccount;
  isAll: boolean;
  locked: boolean;
  selector: ReactNode;
  manager: ReactNode;
  choose: (id: string) => void;
  importRequest: ImportRequest | null;
  requestImport: (file: File, expected?: ImportKind, restore?: boolean) => void;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
};

const NEW_PORTFOLIO = '__create-portfolio';

export default function PortfolioWorkspace({
  session,
  canLock = false,
  children,
}: {
  session: VaultSession;
  lock: () => void;
  /** Locking a portfolio is limited to super admins for now; anyone can still unlock one that is locked. */
  canLock?: boolean;
  children: (controls: WorkspaceControls) => ReactNode;
}) {
  const account = useSyncExternalStore(
    (fn) => session.onChange(fn),
    () => session.account,
    () => session.account,
  );
  const [editId, setEditId] = useState('');
  const [selected, setSelected] = useState(ALL_PORTFOLIOS);
  const [draft, setDraft] = useState<PortfolioTarget | null>(null);
  const [queued, setQueued] = useState<ImportRequest | null>(null);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [childBusy, setChildBusy] = useState(false);
  const [error, setError] = useState('');
  const [restore, setRestore] = useState<
    import('@/lib/vault-backup').BackupPackage | null
  >(null);
  const entry = account.portfolios.find((p) => p.id === selected);
  const target =
    account.portfolios.length === 1 && !draft
      ? { id: account.portfolios[0].id }
      : entry
        ? { id: entry.id }
        : (draft ?? { id: ALL_PORTFOLIOS });
  const deletingEntry = account.portfolios.find((p) => p.id === deleting);
  const isAll = target.id === ALL_PORTFOLIOS;
  const blocked = busy || childBusy || session.offline;

  function choose(id: string) {
    setRequest(null);
    setDraft(null);
    setChildBusy(false);
    setSelected(id);
  }
  const canCreate = account.portfolios.length < MAX_PORTFOLIOS;
  function openCreate() {
    setError('');
    setName('');
    setEditing('create');
  }
  async function mutate(next: PortfolioAccount, replaceAll = false) {
    setBusy(true);
    setError('');
    try {
      if (replaceAll && next.portfolios.length > MAX_PORTFOLIOS)
        throw new Error(`You can keep up to ${MAX_PORTFOLIOS} portfolios.`);
      await session.saveAccount(next, session.revision, { replaceAll });
      // The dashboard holds its own copy of the revision; remount it so the next save starts from this one.
      setVersion((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await session.reload().catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    try {
      if (editing === 'rename')
        await mutate(renamePortfolio(account, editId, name));
      else {
        assertCanAddPortfolio(account);
        const id = crypto.randomUUID();
        await mutate(
          normalizeAccount(
            {
              ...account,
              portfolios: [
                ...account.portfolios,
                { id, name: portfolioName(name), portfolio: blankPortfolio() },
              ],
            },
            false,
          ),
        );
        choose(id);
      }
      setEditing(null);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function requestImport(
    file: File,
    expected?: ImportKind,
    restoreFile = false,
  ) {
    setError('');
    setName('');
    setDestination(
      account.portfolios.length === 1
        ? account.portfolios[0].id
        : (entry?.id ?? ''),
    );
    if (restoreFile) {
      void file
        .text()
        .then(parseBackup)
        .then((parsed) => {
          if (parsed.type === 'encrypted') setRestore(parsed.backup);
          else if (parsed.type === 'account') {
            if (
              window.confirm(
                `Replace every portfolio with these ${parsed.account.portfolios.length} portfolios: ${parsed.account.portfolios.map((p) => p.name).join(', ')}?`,
              )
            )
              void mutate(parsed.account, true)
                .then(() => choose(ALL_PORTFOLIOS))
                .catch(() => {});
          } else setQueued({ file, token: crypto.randomUUID(), restore: true });
        })
        .catch((e) => setError(e.message));
      return;
    }
    setQueued({ file, expected, token: crypto.randomUUID() });
  }
  function startImport() {
    if (!queued) return;
    try {
      const id = destination === 'new' ? crypto.randomUUID() : destination;
      if (!id) throw new Error('Choose a destination portfolio.');
      if (destination === 'new') {
        assertCanAddPortfolio(account);
        const clean = portfolioName(name);
        if (
          account.portfolios.some(
            (p) => p.name.toLowerCase() === clean.toLowerCase(),
          )
        )
          throw new Error('That portfolio name already exists.');
        setDraft({ id, name: clean });
      } else {
        assertPortfolioWritable(account, id);
        setDraft(null);
      }
      setSelected(id);
      setRequest(queued);
      setQueued(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const selector =
    account.portfolios.length > 1 || draft || canCreate ? (
      <select
        className="header-portfolio-select"
        aria-label="Select portfolio"
        value={entry || draft ? selected : ALL_PORTFOLIOS}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === NEW_PORTFOLIO) openCreate();
          else choose(e.target.value);
        }}
      >
        <option value={ALL_PORTFOLIOS}>All</option>
        {account.portfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.locked ? ' · locked' : ''}
          </option>
        ))}
        {draft && !entry ? (
          <option value={draft.id}>{draft.name}</option>
        ) : null}
        {canCreate ? (
          <option value={NEW_PORTFOLIO}>+ Create new portfolio</option>
        ) : null}
      </select>
    ) : (
      <span className="header-portfolio-label">All</span>
    );
  const manager = (
    <div className="portfolio-settings">
      <p className="muted">
        Keep separate portfolios for broker accounts or investment goals. Locked
        portfolios remain visible and cannot be edited.
      </p>
      {account.portfolios.map((p) => (
        <div className="set-row" key={p.id}>
          <div>
            <strong>{p.name}</strong>
            <p className="muted">
              {p.locked ? 'Locked · read only' : 'Open for edits'}
            </p>
          </div>
          <div className="row">
            <button
              className="secondary compact"
              disabled={blocked}
              onClick={() => {
                setEditId(p.id);
                setName(p.name);
                setEditing('rename');
              }}
            >
              Rename
            </button>
            {canLock || p.locked ? (
              <button
                className="secondary compact"
                disabled={blocked}
                onClick={() =>
                  void mutate(
                    setPortfolioLocked(account, p.id, !p.locked),
                  ).catch(() => {})
                }
              >
                {p.locked ? 'Unlock' : 'Lock'}
              </button>
            ) : null}
            {!p.locked && account.portfolios.length > 1 ? (
              <button
                className="secondary compact"
                disabled={blocked}
                onClick={() => {
                  setError('');
                  setDeleting(p.id);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <button
        className="secondary"
        disabled={blocked || !canCreate}
        onClick={openCreate}
      >
        Create portfolio
      </button>
      {!canCreate ? (
        <p className="muted">
          You have reached the limit of {MAX_PORTFOLIOS} portfolios. Delete one
          to create another.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
    </div>
  );
  return (
    <>
      <div key={`${target.id}:${version}`}>
        {children({
          target,
          selected,
          account,
          isAll,
          locked: !!account.portfolios.find((p) => p.id === target.id)?.locked,
          selector,
          manager,
          choose,
          importRequest: request,
          requestImport,
          onBusy: setChildBusy,
          onSaved: () => {
            setDraft(null);
            setRequest(null);
          },
        })}
      </div>
      {draft && !entry ? (
        <p className="notice">
          This portfolio will be created when you save the import.{' '}
          <button
            className="secondary compact"
            disabled={busy || childBusy}
            onClick={() => choose(ALL_PORTFOLIOS)}
          >
            Cancel import
          </button>
        </p>
      ) : null}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && !busy && setEditing(null)}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>
            {editing === 'rename' ? 'Rename portfolio' : 'Create portfolio'}
          </DialogTitle>
          <DialogDescription>
            Keep separate broker accounts or investment goals under one login.
          </DialogDescription>
          {error ? (
            <p role="alert" className="notice error">
              {error}
            </p>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void edit();
            }}
          >
            <label>
              Portfolio name
              <input
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button disabled={busy}>
              {busy ? 'Saving…' : 'Save portfolio'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>Delete portfolio?</DialogTitle>
          <DialogDescription>
            {deletingEntry
              ? `“${deletingEntry.name}” and everything in it will be permanently deleted: ${
                  deletingEntry.portfolio.trades.length
                } transactions, ${
                  deletingEntry.portfolio.dividends?.length ?? 0
                } dividends and ${
                  deletingEntry.portfolio.assets?.length ?? 0
                } other asset entries. This cannot be undone. Download a backup first if you may want it back.`
              : ''}
          </DialogDescription>
          {deletingEntry &&
          account.portfolios[0]?.id === deletingEntry.id ? (
            <p className="notice">
              Monthly Picks keeps its shortlist and saved runs in this
              portfolio, so they will be removed too.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="notice error">
              {error}
            </p>
          ) : null}
          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !deletingEntry}
              onClick={() => {
                if (!deletingEntry) return;
                void mutate(removePortfolio(account, deletingEntry.id))
                  .then(() => {
                    if (selected === deletingEntry.id) choose(ALL_PORTFOLIOS);
                    setDeleting(null);
                  })
                  .catch(() => {});
              }}
            >
              {busy ? 'Deleting…' : 'Delete portfolio and its data'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!queued} onOpenChange={(open) => !open && setQueued(null)}>
        <DialogContent className="form-dialog">
          <DialogTitle>Which portfolio should receive this import?</DialogTitle>
          <DialogDescription>
            {queued?.file.name} · Choose the destination before reviewing the
            file.
          </DialogDescription>
          {error ? (
            <p role="alert" className="notice error">
              {error}
            </p>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startImport();
            }}
          >
            <label>
              Destination portfolio
              <select
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="" disabled>
                  Choose portfolio
                </option>
                {account.portfolios.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.locked}>
                    {p.name}
                    {p.locked ? ' · locked' : ''}
                  </option>
                ))}
                {canCreate ? (
                  <option value="new">Create new portfolio…</option>
                ) : null}
              </select>
            </label>
            {destination === 'new' ? (
              <label>
                New portfolio name
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            ) : null}
            <button>Review import</button>
          </form>
        </DialogContent>
      </Dialog>
      <EncryptedRestoreDialog
        backup={restore}
        onCancel={() => setRestore(null)}
        onRestore={async (next) => {
          if (
            !window.confirm(
              `Replace every portfolio with these ${next.portfolios.length} portfolios: ${next.portfolios.map((p) => p.name).join(', ')}?`,
            )
          )
            return;
          await mutate(next, true);
          setRestore(null);
          choose(ALL_PORTFOLIOS);
        }}
      />
    </>
  );
}
