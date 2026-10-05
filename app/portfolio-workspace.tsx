'use client';

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { blankPortfolio, money, round } from '@/lib/portfolio';
import {
  ALL_PORTFOLIOS,
  accountActivity,
  consolidatedAccount,
  hasFinancialRecords,
  normalizeAccount,
  portfolioName,
  removePortfolio,
  renamePortfolio,
  type PortfolioAccount,
  type PortfolioTarget,
} from '@/lib/portfolio-account';
import { loadAccountView } from '@/lib/portfolio-view';
import type { VaultSession } from '@/lib/vault-client';
import type { ImportKind } from '@/lib/import-detect';
import { parseBackup } from '@/lib/vault-backup';
import { webPublicData } from './vault-transport';
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
  importRequest: ImportRequest | null;
  requestImport: (file: File, expected?: ImportKind, restore?: boolean) => void;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
};

export default function PortfolioWorkspace({
  session,
  lock,
  children,
}: {
  session: VaultSession;
  lock: () => void;
  children: (controls: WorkspaceControls) => ReactNode;
}) {
  const account = useSyncExternalStore(
    (fn) => session.onChange(fn),
    () => session.account,
    () => session.account,
  );
  const [selected, setSelected] = useState(ALL_PORTFOLIOS);
  const [draft, setDraft] = useState<PortfolioTarget | null>(null);
  const [queued, setQueued] = useState<ImportRequest | null>(null);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const [busy, setBusy] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [error, setError] = useState('');
  const [restore, setRestore] = useState<
    import('@/lib/vault-backup').BackupPackage | null
  >(null);
  const entry = account.portfolios.find((p) => p.id === selected);
  const target = entry ? { id: entry.id } : draft;
  const blocked = busy || childBusy || session.offline;

  function choose(id: string) {
    setRequest(null);
    setDraft(null);
    setChildBusy(false);
    setSelected(id);
  }
  async function mutate(next: PortfolioAccount) {
    setBusy(true);
    setError('');
    try {
      await session.saveAccount(next, session.revision);
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
        await mutate(renamePortfolio(account, selected, name));
      else {
        const id = crypto.randomUUID();
        await mutate(
          normalizeAccount({
            ...account,
            portfolios: [
              ...account.portfolios,
              { id, name: portfolioName(name), portfolio: blankPortfolio() },
            ],
          }),
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
    setDestination(entry?.id ?? '');
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
              void mutate(parsed.account)
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
        const clean = portfolioName(name);
        if (
          account.portfolios.some(
            (p) => p.name.toLowerCase() === clean.toLowerCase(),
          )
        )
          throw new Error('That portfolio name already exists.');
        setDraft({ id, name: clean });
      } else setDraft(null);
      setSelected(id);
      setRequest(queued);
      setQueued(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <>
      <div className="portfolio-switcher" aria-label="Portfolio management">
        <label>
          Portfolio{' '}
          <select
            aria-label="Select portfolio"
            value={entry || draft ? selected : ALL_PORTFOLIOS}
            disabled={busy || childBusy}
            onChange={(e) => choose(e.target.value)}
          >
            <option value={ALL_PORTFOLIOS}>All portfolios</option>
            {account.portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {draft && !entry ? (
              <option value={draft.id}>{draft.name} · unsaved</option>
            ) : null}
          </select>
        </label>
        <button
          className="secondary compact"
          disabled={blocked}
          onClick={() => {
            setName('');
            setEditing('create');
          }}
        >
          Create portfolio
        </button>
        {entry ? (
          <button
            className="secondary compact"
            disabled={blocked}
            onClick={() => {
              setName(entry.name);
              setEditing('rename');
            }}
          >
            Rename
          </button>
        ) : null}
        {entry &&
        !hasFinancialRecords(entry.portfolio) &&
        account.portfolios.length > 1 ? (
          <button
            className="secondary compact"
            disabled={blocked}
            onClick={() => {
              if (window.confirm(`Delete the empty portfolio “${entry.name}”?`))
                void mutate(removePortfolio(account, entry.id))
                  .then(() => choose(ALL_PORTFOLIOS))
                  .catch(() => {});
            }}
          >
            Delete empty portfolio
          </button>
        ) : null}
        <button
          className="secondary compact"
          disabled={busy || childBusy}
          onClick={lock}
        >
          Lock
        </button>
      </div>
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
      {selected === ALL_PORTFOLIOS || !target ? (
        <AllPortfolios
          session={session}
          account={account}
          onSelect={choose}
          onImport={requestImport}
          onRestore={(file) => requestImport(file, undefined, true)}
        />
      ) : (
        <div key={target.id}>
          {children({
            target,
            importRequest: request,
            requestImport,
            onBusy: setChildBusy,
            onSaved: () => {
              setDraft(null);
              setRequest(null);
            },
          })}
          {draft && !entry ? (
            <div className="portfolio-switcher">
              <span>
                This portfolio is created only when the import is saved.
              </span>
              <button
                className="secondary"
                disabled={busy || childBusy}
                onClick={() => choose(ALL_PORTFOLIOS)}
              >
                Cancel new portfolio import
              </button>
            </div>
          ) : null}
        </div>
      )}
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
      <Dialog open={!!queued} onOpenChange={(open) => !open && setQueued(null)}>
        <DialogContent className="form-dialog">
          <DialogTitle>Which portfolio should receive this import?</DialogTitle>
          <DialogDescription>
            {queued?.file.name} · Choose the destination before reviewing the
            file.
          </DialogDescription>
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
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="new">Create new portfolio…</option>
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
          await mutate(next);
          setRestore(null);
          choose(ALL_PORTFOLIOS);
        }}
      />
    </>
  );
}

function AllPortfolios({
  session,
  account,
  onSelect,
  onImport,
  onRestore,
}: {
  session: VaultSession;
  account: PortfolioAccount;
  onSelect: (id: string) => void;
  onImport: (file: File) => void;
  onRestore: (file: File) => void;
}) {
  const [view, setView] = useState(account);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('holdings');
  useEffect(() => {
    let alive = true;
    void loadAccountView(session, webPublicData, true)
      .then((out) => {
        if (alive) setView(out.account);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [session, session.revision]);
  // Reload emits a new account object. Depend on revision, rather than repeating loads after each decrypt.
  const result = consolidatedAccount(view);
  const shown = (n: number | null) => (n === null ? 'Unknown' : money(n));
  const activity = accountActivity(view);
  function downloadBackup(readable: boolean) {
    void (
      readable
        ? Promise.resolve({
            kind: 'sipwise-portfolio-account-backup',
            schemaVersion: 1,
            account: session.account,
          })
        : session.backupPackage()
    )
      .then((data) => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
          }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = readable
          ? 'sipwise-all-portfolios.json'
          : 'sipwise-encrypted-backup.json';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setError(e.message));
  }
  return (
    <main className="desk consolidated-view">
      <header className="app-header">
        <h1>All portfolios</h1>
        <button
          className="secondary compact"
          onClick={() => window.location.assign('/api/auth/logout')}
        >
          Sign out
        </button>
      </header>
      <p className="muted">
        {view.portfolios.length} portfolios · Combined investments in PKR
      </p>
      {error ? <p className="notice error">{error}</p> : null}
      {result.summary.incomplete.length ? (
        <p className="notice">
          {result.summary.missingPrice.length
            ? `Missing prices: ${result.summary.missingPrice.join(', ')}. `
            : ''}
          {result.summary.unknownCost.length
            ? `Unknown costs: ${result.summary.unknownCost.join(', ')}. `
            : ''}
          Incomplete amounts are labelled.
        </p>
      ) : null}
      <div className="account-stats">
        <article>
          <small>
            {result.summary.missingPrice.length
              ? 'Priced market value · incomplete'
              : 'Market value'}
          </small>
          <strong>{shown(result.summary.value)}</strong>
        </article>
        <article>
          <small>Remaining invested cost</small>
          <strong>{shown(result.summary.cost)}</strong>
        </article>
        <article>
          <small>Unrealised gain / loss</small>
          <strong>{shown(result.summary.gain)}</strong>
        </article>
        <article>
          <small>Received dividends · gross</small>
          <strong>{shown(result.tax.receivedDividends)}</strong>
        </article>
      </div>
      <div className="row">
        <label className="secondary compact">
          Import file
          <input
            aria-label="Import into a portfolio"
            type="file"
            accept=".json,.pdf,.csv,.xlsx"
            onChange={(e) => {
              if (e.target.files?.[0]) onImport(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button
          className="secondary compact"
          onClick={() => downloadBackup(false)}
        >
          Encrypted backup
        </button>
        <button
          className="secondary compact"
          onClick={() => {
            if (
              window.confirm(
                'Export all portfolios as readable data? Anyone with this file can read your investments.',
              )
            )
              downloadBackup(true);
          }}
        >
          Readable export
        </button>
        <label className="secondary compact">
          Restore backup
          <input
            type="file"
            accept=".json"
            aria-label="Restore account backup"
            onChange={(e) => {
              if (e.target.files?.[0]) onRestore(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <div className="account-breakdown">
        {result.breakdown.map((p) => (
          <button
            key={p.id}
            className="secondary"
            onClick={() => onSelect(p.id)}
          >
            <strong>{p.name}</strong>
            <span>
              {p.summary.missingPrice.length
                ? `${shown(p.summary.value)} priced · incomplete`
                : shown(p.summary.value)}{' '}
              · {p.summary.heldCount} holdings
            </span>
            <small>Open portfolio →</small>
          </button>
        ))}
      </div>
      <nav className="row" aria-label="Consolidated views">
        {[
          'holdings',
          'reports',
          'activity',
          'notifications',
          'SIP & picks',
        ].map((tab) => (
          <button
            key={tab}
            className={mode === tab ? '' : 'secondary'}
            onClick={() => setMode(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      {mode === 'holdings' ? (
        <div className="account-table">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Shares</th>
                <th>Cost</th>
                <th>Value</th>
                <th>Gain / loss</th>
                <th>Weight</th>
                <th>Portfolio breakdown</th>
              </tr>
            </thead>
            <tbody>
              {result.positions.map((h) => (
                <tr key={h.ticker}>
                  <td>
                    <b>{h.ticker}</b>
                    <small>{h.name}</small>
                  </td>
                  <td>{h.shares}</td>
                  <td>{shown(h.cost)}</td>
                  <td>{shown(h.value)}</td>
                  <td>{shown(h.gain)}</td>
                  <td>
                    {h.value === null ||
                    result.summary.missingPrice.length > 0 ||
                    !result.summary.value
                      ? '—'
                      : `${round((h.value / result.summary.value) * 100)}%`}
                  </td>
                  <td>
                    {h.portfolios.map((p) => (
                      <button
                        className="secondary compact"
                        key={p.id}
                        onClick={() => onSelect(p.id)}
                      >
                        {p.name}: {p.shares} shares · {shown(p.value)}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.positions.length ? (
            <p>Create a portfolio or import your broker history to begin.</p>
          ) : null}
        </div>
      ) : null}
      {mode === 'reports' ? (
        <section>
          <h2>Combined results</h2>
          <div className="account-stats">
            <article>
              <small>
                Realised gain / loss
                {result.tax.unknownSaleCosts ? ' · known costs only' : ''}
              </small>
              <strong>{shown(result.tax.realizedGain)}</strong>
            </article>
            <article>
              <small>Net realised return</small>
              <strong>{shown(result.tax.netRealizedReturn)}</strong>
            </article>
            <article>
              <small>Capital gains tax</small>
              <strong>{shown(result.tax.capitalGainsTax)}</strong>
            </article>
            <article>
              <small>Dividend tax</small>
              <strong>{shown(result.tax.dividendTax)}</strong>
            </article>
          </div>
          <p className="muted">
            Tax figures sum each portfolio’s recorded deductions and estimates.{' '}
            {result.tax.expectedDividends} expected dividends are excluded from
            received income. Open a portfolio for its detailed charts and
            tax-year report.
          </p>
        </section>
      ) : null}
      {mode === 'activity' ? (
        <div className="account-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Portfolio</th>
                <th>Company</th>
                <th>Entry</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((e) => (
                <tr key={`${e.portfolioId}:${e.kind}:${e.id}`}>
                  <td>{e.date}</td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => onSelect(e.portfolioId)}
                    >
                      {e.portfolioName}
                    </button>
                  </td>
                  <td>{e.ticker}</td>
                  <td>{e.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {mode === 'notifications' ? (
        <section>
          {view.portfolios.flatMap((p) =>
            (p.portfolio.notifications ?? [])
              .filter((n) => !n.clearedAt)
              .map((n) => (
                <article key={`${p.id}:${n.id}`}>
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                  <button
                    className="secondary compact"
                    onClick={() => onSelect(p.id)}
                  >
                    Open {p.name} notifications
                  </button>
                </article>
              )),
          )}
        </section>
      ) : null}
      {mode === 'SIP & picks' ? (
        <section>
          <h2>Choose a portfolio to plan purchases</h2>
          <p>
            Each portfolio has its own monthly budget, targets, and Monthly
            Picks.
          </p>
          {view.portfolios.map((p) => (
            <button
              className="secondary"
              key={p.id}
              onClick={() => onSelect(p.id)}
            >
              {p.name} →
            </button>
          ))}
        </section>
      ) : null}
    </main>
  );
}
