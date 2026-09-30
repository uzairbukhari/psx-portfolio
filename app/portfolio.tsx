'use client';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Toaster, toast as toastManager } from '@/components/ui/toast';
import {
  DEFAULT_RESEARCH_SETTINGS,
  holdings,
  plan,
  quoteSupersedes,
  today,
  type AppNotification,
  type Portfolio,
} from '@/lib/portfolio';
import { AppHeader } from './app-header';
import { Brand, DESCRIPTOR } from './brand';
import { DialogHost } from './dialogs/dialog-host';
import { clonePortfolio, usePortfolio } from './hooks/use-portfolio';
import { useImports } from './hooks/use-imports';
import { usePortfolioSummary } from './hooks/use-portfolio-summary';
import { useUrlTab } from './hooks/use-url-tab';
import { CHROMELESS_TABS } from './navigation';
import { Overview } from './overview';
import {
  PortfolioProvider,
  usePortfolioContext,
  type DialogRequest,
  type PortfolioContextValue,
  type ToastOptions,
} from './portfolio-context';
import { PrimaryNav } from './primary-nav';
import { type PsxMarketPulseHandle } from './psx-market-pulse';
import { LoadError, SignIn } from './sign-in';
import { TabLoader } from './tab-loader';
import { CompanyNavProvider } from './ticker-link';
import LedgerTimeline, { buildEntries } from './ledger-timeline';

// Heavy or rarely-first-visited sections load on demand, each with a loader local to that section.
const PortfolioReports = lazy(() => import('./portfolio-reports'));
const MonthlyPicks = lazy(() => import('./monthly-picks'));
const CompanyDetail = lazy(() => import('./company-detail'));
const ResearchDesk = lazy(() => import('./research-desk'));
const SettingsView = lazy(() => import('./settings-view'));
const NotificationsView = lazy(() => import('./notifications-view'));

type QuoteRefreshResponse = {
  quotes: Portfolio['quotes'];
  errors: string[];
  reasons?: Record<string, string>;
  stale?: Record<string, string>;
  error?: string;
};

export default function Dashboard({
  email,
  name,
  picture,
  role,
}: {
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'super_admin' | 'user';
}) {
  const initialPathname = usePathname();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const notify = useCallback((s: string, error = false) => {
    setMessage(s);
    setFailed(error);
  }, []);
  const store = usePortfolio(!!email, (notice) =>
    notify(notice.message, !!notice.error),
  );

  if (!email) return <SignIn returnTo={initialPathname || '/'} />;
  if (!store.p && store.status === 'error')
    return (
      <LoadError
        message={store.loadError}
        busy={false}
        onRetry={() => void store.retry()}
      />
    );
  if (!store.p)
    return (
      <main className="app-loading">
        <Brand />
        <Spinner className="size-6" />
        <p className="muted">Loading your holdings…</p>
      </main>
    );
  return (
    <PortfolioApp
      key={email}
      store={store}
      p={store.p}
      email={email}
      name={name}
      picture={picture}
      role={role}
      initialPathname={initialPathname}
      message={message}
      failed={failed}
      notify={notify}
      clearMessage={() => setMessage('')}
    />
  );
}

function PortfolioApp({
  store,
  p,
  email,
  name,
  picture,
  role,
  initialPathname,
  message,
  failed,
  notify,
  clearMessage,
}: {
  store: ReturnType<typeof usePortfolio>;
  p: Portfolio;
  email: string;
  name: string | null;
  picture: string | null;
  role: 'super_admin' | 'user';
  initialPathname: string;
  message: string;
  failed: boolean;
  notify: (message: string, error?: boolean) => void;
  clearMessage: () => void;
}) {
  const isAdmin = role === 'super_admin';
  const pulseRef = useRef<PsxMarketPulseHandle>(null);
  const { tab, companyTicker, setTab, openCompany } = useUrlTab(
    initialPathname,
    isAdmin,
  );
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [fees, setFees] = useState(0);
  const [usage, setUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  } | null>(null);
  const summary = usePortfolioSummary(p);
  const latestRef = useRef(p);
  useEffect(() => {
    latestRef.current = p;
  }, [p]);

  const toast = useCallback((options: ToastOptions) => {
    toastManager.add({
      title: options.title,
      description: options.description,
      type: options.type ?? 'info',
      actionProps: options.action
        ? { children: options.action.label, onClick: options.action.onClick }
        : undefined,
    });
  }, []);

  const save = store.save;
  const refreshPrices = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      notify('Fetching PSX prices…');
      void pulseRef.current?.refresh();
      const current = latestRef.current;
      const r = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: current.companies.map((c) => c.ticker) }),
      });
      const d = (await r.json()) as QuoteRefreshResponse;
      if (!r.ok) throw Error(d.error);
      // A stale cached quote must not replace one the ledger already holds, and
      // an older or same-day PSX price never replaces a newer or manual quote.
      const fresh = Object.fromEntries(
        Object.entries(d.quotes).filter(
          ([ticker, quote]) =>
            !(d.stale?.[ticker] && current.quotes[ticker]) &&
            quoteSupersedes(quote, current.quotes[ticker]),
        ),
      );
      await save({
        ...latestRef.current,
        quotes: { ...latestRef.current.quotes, ...fresh },
      });
      const stale = Object.keys(d.stale ?? {});
      notify(
        `${Object.keys(d.quotes).length - stale.length} PSX prices up to date.${stale.length ? ` Last saved price kept for ${stale.join(', ')} (${[...new Set(Object.values(d.stale ?? {}))].join(' | ')}).` : ''}${d.errors.length ? ' Unavailable: ' + d.errors.join(', ') + '. Previous quotes retained.' + (d.reasons ? ' Reason: ' + [...new Set(Object.values(d.reasons))].join(' | ') : '') : ''}`,
        !!d.errors.length || !!stale.length,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, notify, save]);

  const busy = store.saving || refreshing;
  const ctx = useMemo<PortfolioContextValue>(
    () => ({
      p,
      saving: store.saving,
      refreshing,
      busy,
      isAdmin,
      save: async (next) => {
        await save(next);
      },
      reload: store.reload,
      latest: () => latestRef.current,
      notify,
      toast,
      openCompany,
      goTab: setTab,
      openDialog: setDialog,
      refreshPrices,
    }),
    [p, store.saving, store.reload, refreshing, busy, isAdmin, save, notify, toast, openCompany, setTab, refreshPrices],
  );

  useEffect(() => {
    if (tab !== 'settings' || usage) return;
    void fetch('/api/usage')
      .then(
        (r) =>
          r.json() as Promise<{
            inputTokens: number;
            outputTokens: number;
            costUsd: number;
          }>,
      )
      .then((d) => setUsage(d))
      .catch(() => {});
  }, [tab, usage]);

  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (tool: unknown, opts: unknown) => void };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const abort = new AbortController();
    try {
      context.registerTool(
        {
          name: 'read_psx_portfolio',
          description:
            'Read holdings, quote dates and monthly SIP plan. Does not place orders or modify records.',
          inputSchema: {
            type: 'object',
            properties: {
              month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            },
            required: ['month'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: (input: unknown) => {
            const m = (input as { month: string })?.month;
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw Error('Invalid month');
            return { holdings: holdings(p), plan: plan(p, m, fees, false) };
          },
        },
        { signal: abort.signal },
      );
    } catch {}
    return () => abort.abort();
  }, [p, fees]);

  return (
    <PortfolioProvider value={ctx}>
      <Toaster>
        <AppBody
          tab={tab}
          companyTicker={companyTicker}
          email={email}
          name={name}
          picture={picture}
          role={role}
          isAdmin={isAdmin}
          message={message}
          failed={failed}
          clearMessage={clearMessage}
          summary={summary}
          pulseRef={pulseRef}
          month={month}
          setMonth={setMonth}
          fees={fees}
          setFees={setFees}
          usage={usage}
          openCompany={openCompany}
          setTab={setTab}
          dialog={dialog}
          closeDialog={() => setDialog(null)}
        />
      </Toaster>
    </PortfolioProvider>
  );
}

function AppBody({
  tab,
  companyTicker,
  email,
  name,
  picture,
  role,
  isAdmin,
  message,
  failed,
  clearMessage,
  summary,
  pulseRef,
  month,
  setMonth,
  fees,
  setFees,
  usage,
  openCompany,
  setTab,
  dialog,
  closeDialog,
}: {
  tab: string;
  companyTicker: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: 'super_admin' | 'user';
  isAdmin: boolean;
  message: string;
  failed: boolean;
  clearMessage: () => void;
  summary: ReturnType<typeof usePortfolioSummary>;
  pulseRef: React.RefObject<PsxMarketPulseHandle | null>;
  month: string;
  setMonth: (m: string) => void;
  fees: number;
  setFees: (n: number) => void;
  usage: { inputTokens: number; outputTokens: number; costUsd: number } | null;
  openCompany: (ticker: string) => void;
  setTab: (tab: string) => void;
  dialog: DialogRequest | null;
  closeDialog: () => void;
}) {
  const { p, busy, save, notify, openDialog, refreshPrices } = usePortfolioContext();
  const imports = useImports();
  const chromeless = CHROMELESS_TABS.has(tab);
  const allNotifications = p.notifications ?? [];

  /** Persists read/cleared state of the notification list. */
  function updateNotifications(
    change: (list: AppNotification[]) => AppNotification[],
  ) {
    imports.attempt(async () => {
      const next = clonePortfolio(p);
      next.notifications = change(next.notifications ?? []);
      await save(next);
      notify('Notifications updated.');
    });
  }
  /** Modules that predate the dialogs save with an optional success message; errors still reach the page notice. */
  const saveWithMessage = async (next: Portfolio, success = 'Saved to your private portfolio.') => {
    try {
      await save(next);
      notify(success);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
      throw e;
    }
  };

  const ledgerEntries = (ticker?: string) =>
    buildEntries({
      trades: p.trades.filter((t) => !ticker || t.ticker === ticker),
      dividends: (p.dividends ?? []).filter((d) => !ticker || d.ticker === ticker),
      splits: (p.stockSplits ?? []).filter((x) => !ticker || x.ticker === ticker),
      taxed: summary.taxedDividends,
      onCorrectTrade: (t) => openDialog({ type: 'trade', editing: t }),
      onCorrectDividend: (d) => openDialog({ type: 'dividend', editing: d }),
      onCorrectSplit: (s) => openDialog({ type: 'split', editing: s }),
      onConfirmDividend: (d) => openDialog({ type: 'receipt', dividend: d }),
    });

  const companySummary = (ticker: string) => {
    const h = summary.hs.find((x) => x.ticker === ticker);
    const received = summary.taxedDividends.filter(
      (d) => d.ticker === ticker && d.status === 'received',
    );
    const dividendGross = received.reduce((a, d) => a + d.grossAmount, 0);
    const dividendNet = received.some((d) => d.netAmount === null)
      ? null
      : received.reduce((a, d) => a + (d.netAmount ?? 0), 0);
    return {
      cost: h?.cost ?? null,
      value: h?.value ?? null,
      gain: h?.gain ?? null,
      gainPercent:
        h?.gain !== null && h?.gain !== undefined && h.cost
          ? Math.round((h.gain / h.cost) * 10000) / 100
          : null,
      dividendGross: Math.round(dividendGross * 100) / 100,
      dividendNet: dividendNet === null ? null : Math.round(dividendNet * 100) / 100,
    };
  };

  return (
    <CompanyNavProvider value={openCompany}>
      <main className="desk">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppHeader
          email={email}
          name={name}
          picture={picture}
          companyTicker={tab === 'company' ? companyTicker : ''}
          notifications={allNotifications}
          onNotifications={updateNotifications}
        />
        {!chromeless && (
          <PrimaryNav tab={tab} isAdmin={isAdmin} onNavigate={setTab} />
        )}
        <div id="main-content" tabIndex={-1}>
          {message && (
            <div
              role={failed ? 'alert' : 'status'}
              className={'notice ' + (failed ? 'error' : 'success')}
            >
              <span>{message}</span>
              <button
                type="button"
                data-slot="notice-close"
                className="notice-close"
                aria-label="Dismiss message"
                onClick={clearMessage}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <Suspense fallback={<TabLoader label="Loading…" />}>
            {tab === 'holdings' && <Overview summary={summary} pulseRef={pulseRef} />}
            {tab === 'reports' && <PortfolioReports portfolio={p} />}
            {tab === 'sip' && (
              <MonthlyPicks
                portfolio={p}
                month={month}
                setMonth={setMonth}
                feePct={fees}
                setFeePct={setFees}
                busy={busy}
                onSave={saveWithMessage}
                onRefreshPrices={refreshPrices}
                onOpenCompany={openCompany}
                onManualPrice={(ticker) => openDialog({ type: 'quote', ticker })}
              />
            )}
            {tab === 'history' && (
              <>
                <div className="section-top">
                  <div>
                    <h1 className="page-title">Activity</h1>
                    <p>
                      Every purchase, sale, dividend and split in one dated
                      timeline. Open a company for its own page.
                    </p>
                  </div>
                </div>
                <LedgerTimeline
                  portfolio={p}
                  entries={ledgerEntries(undefined)}
                  onOpenCompany={openCompany}
                />
              </>
            )}
            {tab === 'company' && companyTicker && (
              <CompanyDetail
                ticker={companyTicker}
                holding={summary.hs.find((h) => h.ticker === companyTicker)}
                summary={companySummary(companyTicker)}
                entries={ledgerEntries(companyTicker)}
                taxed={summary.taxedDividends}
                onBack={() => setTab('holdings')}
              />
            )}
            {tab === 'research-desk' && isAdmin && (
              <ResearchDesk
                portfolio={p}
                onSave={saveWithMessage}
                onOpenSettings={() => setTab('settings')}
              />
            )}
            {tab === 'settings' && (
              <SettingsView
                name={name}
                email={email}
                picture={picture}
                role={role}
                busy={busy}
                usage={usage}
                filerStatus={p.taxProfile?.filerStatus ?? ''}
                researchSettings={p.researchSettings ?? DEFAULT_RESEARCH_SETTINGS}
                onBack={() => setTab('holdings')}
                onFilerStatus={(filerStatus) =>
                  imports.attempt(() =>
                    saveWithMessage({ ...p, taxProfile: { filerStatus } }, 'Tax status saved.'),
                  )
                }
                onResearchSettings={(patch) =>
                  imports.attempt(() =>
                    saveWithMessage(
                      {
                        ...p,
                        researchSettings: {
                          ...(p.researchSettings ?? DEFAULT_RESEARCH_SETTINGS),
                          ...patch,
                        },
                      },
                      'AI model settings saved.',
                    ),
                  )
                }
                onExport={imports.exportBackup}
                onRestore={imports.restoreBackup}
                onImportCdc={imports.importCdc}
                onImportFinqalab={imports.importFinqalab}
                onImportAhl={imports.importAhl}
              />
            )}
            {tab === 'notifications' && (
              <NotificationsView
                notifications={allNotifications}
                busy={busy}
                onChange={updateNotifications}
                onBack={() => setTab('holdings')}
              />
            )}
          </Suspense>
        </div>
        <footer>
          <div className="row">
            <span>
              FolioRaah · {DESCRIPTOR} · All amounts in PKR · Private saved ledger
            </span>
          </div>
          <p>
            Plans are estimates. Actual execution prices, fees, taxes and
            corporate actions may differ. No orders are placed by this dashboard.
          </p>
        </footer>
        <DialogHost request={dialog} onClose={closeDialog} />
      </main>
    </CompanyNavProvider>
  );
}
