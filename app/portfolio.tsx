'use client';
import { useConfirm } from '@/components/confirm-dialog';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Toaster, toast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/spinner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  RefreshCw,
  Plus,
  Wallet,
  LogOut,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Bell,
  BarChart3,
  ScrollText,
  Sparkles,
  FlaskConical,
} from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import {
  holdings,
  portfolioSummary,
  plan,
  money,
  moneyShort,
  today,
  round,
  validate,
  SECTORS,
  sharesHeldOn,
  sharesHeldBefore,
  taxSummary,
  dateOK,
  DEFAULT_RESEARCH_SETTINGS,
  type ResearchSettings,
  type Portfolio,
  type Trade,
  type Company,
  type Dividend,
  type StockSplit,
  isValidQuote,
  quoteSupersedes,
  supersedeAutoWithImports,
  confirmDividendReceipt,
  type AppNotification,
} from '@/lib/portfolio';
import {
  addNotifications,
  dividendNotifications,
} from '@/lib/notifications';
import { syncAutoDividends } from '@/lib/dividend-sync';
import type { PayoutAnnouncement } from '@/lib/psx-payouts';
import PortfolioReports from './portfolio-reports';
import PortfolioValueCard from './portfolio-value-card';
import CompanyDetail from './company-detail';
import LedgerTimeline, { buildEntries } from './ledger-timeline';
import { CompanyNavProvider } from './ticker-link';
import ResearchDesk from './research-desk';
import { SignIn, LoadError } from './sign-in';
import { UserAvatar } from './user-avatar';
import NotificationsView from './notifications-view';
import TargetsEditor from './targets-editor';
import SettingsView from './settings-view';
import PsxMarketPulse, { type PsxMarketPulseHandle } from './psx-market-pulse';
import MonthlyPicks from './monthly-picks';
import { importFinqalabTrades, parseFinqalabReport } from './finqalab-import';
import { extractPdfText } from './research-pdf';
import { importAhlTrades, parseAhlHistory } from './ahl-import';
import { importCdcDividends } from '@/lib/cdc-import';
import { verifyPsxSymbol } from './psx-symbol';

const TAB_PATHS: Record<string, string> = {
  holdings: '/',
  reports: '/reports',
  sip: '/sip',
  history: '/activity',
  'research-desk': '/research-desk',
  settings: '/settings',
  notifications: '/notifications',
};
const PATH_TABS: Record<string, string> = Object.fromEntries(
  [...Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]), ['/history', 'history']],
);
const COMPANY_PATH = new RegExp('^/company/([A-Za-z0-9]{2,12})/?$');
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia('(min-width: 1100px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function companyFromPathname(pathname: string): string {
  const match = COMPANY_PATH.exec(pathname);
  return match ? match[1].toUpperCase() : '';
}
/** Non-admins never land on the Research desk, even via a direct URL or history entry. */
function allowTab(tab: string, isAdmin: boolean): string {
  return tab === 'research-desk' && !isAdmin ? 'holdings' : tab;
}
function tabFromPathname(pathname: string): string {
  return companyFromPathname(pathname) ? 'company' : (PATH_TABS[pathname] ?? 'holdings');
}
type ApiResponse = {
  error?: string;
  portfolio: Portfolio;
  revision: number;
  announcements?: PayoutAnnouncement[];
  available?: boolean;
  cached?: boolean;
  estimatedCostUsd?: number;
  quotes: Portfolio['quotes'];
  errors: string[];
  reasons?: Record<string, string>;
  summary?: string;
  weights?: Record<string, number>;
};
type QuoteRefreshResponse = {
  quotes: Portfolio['quotes'];
  errors: string[];
  reasons?: Record<string, string>;
  stale?: Record<string, string>;
  error?: string;
};
const SHORTLISTED = '__shortlisted';
type HoldingsSortKey =
  | 'name'
  | 'shares'
  | 'average'
  | 'price'
  | 'value'
  | 'gain'
  | 'weight';
const clone = (p: Portfolio): Portfolio => JSON.parse(JSON.stringify(p));
function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type TxType = 'buy' | 'sell' | 'dividend' | 'split' | 'opening';
const TX_TYPES: { type: TxType; label: string }[] = [
  { type: 'buy', label: 'Buy' },
  { type: 'sell', label: 'Sell' },
  { type: 'dividend', label: 'Dividend' },
  { type: 'split', label: 'Bonus / split' },
  { type: 'opening', label: 'Opening balance' },
];
const blankTrade = (
  ticker = '',
  kind: Trade['kind'] = 'buy',
  price: number | null = null,
): Trade => ({
  id: crypto.randomUUID(),
  ticker,
  kind,
  date: today(),
  shares: 0,
  price,
  fees: 0,
  month: kind === 'buy' ? today().slice(0, 7) : '',
  note: '',
});
type PickBuy = { ticker: string; shares: number; price: number | null };
type PickQueue = { picks: PickBuy[]; month: string; index: number };
const blankDividend = (ticker: string): Dividend => ({
  id: crypto.randomUUID(),
  ticker,
  date: today(),
  source: 'manual',
  perShare: 0,
  grossAmount: 0,
  note: '',
});
const blankStockSplit = (ticker: string): StockSplit => ({
  id: crypto.randomUUID(),
  ticker,
  date: today(),
  oldShares: 0,
  newShares: 0,
  note: '',
});
/** Searchable ticker + name picker. Owned-only pickers only emit tickers from the list. */
function TickerPicker({
  value,
  onChange,
  companies,
  allowNew,
  disabled,
}: {
  value: string;
  onChange: (ticker: string) => void;
  companies: Company[];
  allowNew: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = companies
    .filter(
      (c) =>
        !q ||
        c.ticker.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    )
    .slice(0, 8);
  function type(text: string) {
    setQuery(text);
    setOpen(true);
    const exact = companies.find(
      (c) => c.ticker.toLowerCase() === text.trim().toLowerCase(),
    );
    onChange(exact ? exact.ticker : allowNew ? text.trim().toUpperCase() : '');
  }
  return (
    <div className="ticker-picker">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls="ticker-picker-list"
        aria-label="Company symbol"
        placeholder={allowNew ? 'Search or type a PSX symbol' : 'Search your companies'}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        disabled={disabled}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => type(e.target.value)}
      />
      {open && matches.length > 0 && (
        <div id="ticker-picker-list" className="ticker-options">
          {matches.map((c) => (
            <button
              type="button"
              data-slot="option"
              key={c.ticker}
              aria-pressed={c.ticker === value}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(c.ticker);
                setOpen(false);
                onChange(c.ticker);
              }}
            >
              <b>{c.ticker}</b>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
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
  const isAdmin = role === 'super_admin';
  const pulseRef = useRef<PsxMarketPulseHandle>(null);
  // From 1100px the market pulse sits beside the value card's chart; below it stays under the table.
  const widePulse = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia('(min-width: 1100px)').matches,
    () => null,
  );
  const initialPathname = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  const [tab, setTabState] = useState(() =>
    allowTab(tabFromPathname(initialPathname), isAdmin),
  );
  const [companyTicker, setCompanyTicker] = useState(() =>
    companyFromPathname(initialPathname),
  );
  function setTab(requested: string) {
    const next = allowTab(requested, isAdmin);
    setTabState(next);
    const path = TAB_PATHS[next] ?? '/';
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  }
  useEffect(() => {
    function onPopState() {
      setTabState(
        allowTab(tabFromPathname(window.location.pathname), isAdmin),
      );
      setCompanyTicker(companyFromPathname(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAdmin]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pickQueue, setPickQueue] = useState<PickQueue | null>(null);
  const [p, setP] = useState<Portfolio | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessageState] = useState(''),
    [failed, setFailed] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [fees, setFees] = useState(0),
    [allowOld] = useState(false);
  const [trade, setTrade] = useState<Trade | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [stockSplit, setStockSplit] = useState<StockSplit | null>(null),
    [editingStockSplit, setEditingStockSplit] = useState<string | null>(null),
    [dividend, setDividend] = useState<Dividend | null>(null),
    [receipt, setReceipt] = useState<{
      dividend: Dividend;
      paymentDate: string;
      gross: string;
      tax: string;
    } | null>(null),
    [editingDividend, setEditingDividend] = useState<string | null>(null),
    [company, setCompany] = useState<Company | null>(null),
    [creatingCompany, setCreatingCompany] = useState(false),
    [txType, setTxType] = useState<TxType>('buy'),
    [txCompany, setTxCompany] = useState({ name: '', sector: '' }),
    [quoteTicker, setQuoteTicker] = useState(''),
    [quotePrice, setQuotePrice] = useState(''),
    [quoteDate, setQuoteDate] = useState(today()),
    [usage, setUsage] = useState<{
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    } | null>(null);
  const [holdingsSort, setHoldingsSort] = useState<{
      key: HoldingsSortKey;
      dir: 'asc' | 'desc';
    } | null>(null),
    [sectorFilter, setSectorFilter] = useState<string>(''),
    [showSoldOut, setShowSoldOut] = useState(false),
    [targetsOpen, setTargetsOpen] = useState(false);
  // Status messages surface as toasts instead of an inline banner: errors
  // persist until dismissed, successes auto-dismiss. Before the first
  // portfolio load, the full-page LoadError screen shows `message` itself.
  const loadedRef = useRef(false);
  useEffect(() => {
    loadedRef.current = !!p;
  }, [p]);
  function showToast(s: string, error: boolean) {
    if (!s || !loadedRef.current) return;
    toast.add({
      description: s,
      type: error ? 'error' : 'success',
      priority: error ? 'high' : 'low',
      timeout: error ? 0 : 5000,
    });
  }
  function notify(s: string, error = false) {
    setMessageState(s);
    setFailed(error);
    showToast(s, error);
  }
  async function load() {
    setBusy(true);
    try {
      const r = await fetch('/api/portfolio');
      const d = (await r.json()) as ApiResponse;
      if (!r.ok) throw Error(d.error);
      setP(d.portfolio);
      setRevision(d.revision);
      await recordAutoDividends(d.portfolio, d.revision, d.announcements ?? []);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  /**
   * Records cash dividends PSX announced for held companies (as expected, unconfirmed
   * dividends) and posts payout news, in one revisioned save. If the portfolio changed
   * meanwhile (409), it reloads the fresh copy and recomputes against that revision
   * instead of giving up, so a background save never silently loses the update.
   */
  async function recordAutoDividends(
    loaded: Portfolio,
    loadedRevision: number,
    announcements: PayoutAnnouncement[],
  ) {
    const result = await syncAutoDividends(
      { portfolio: loaded, revision: loadedRevision },
      announcements,
      {
        save: async (next, revision) => {
          const r = await fetch('/api/portfolio', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolio: next, revision }),
          });
          if (r.status === 409) return { conflict: true };
          const saved = (await r.json()) as ApiResponse;
          if (!r.ok) throw Error(saved.error);
          return { revision: saved.revision };
        },
        reload: async () => {
          const fresh = await fetch('/api/portfolio');
          if (!fresh.ok) return null;
          const d = (await fresh.json()) as ApiResponse;
          return d.portfolio ? { portfolio: d.portfolio, revision: d.revision } : null;
        },
      },
    );
    if (result.portfolio !== loaded) {
      setP(result.portfolio);
      setRevision(result.revision);
    }
    if (result.status === 'failed')
      notify('Could not record PSX dividends: ' + result.error, true);
    else if (result.status === 'saved' && result.update) {
      const { next, pending, voided } = result.update;
      if (voided.length)
        notify(
          `${voided.length} past expected dividend${voided.length === 1 ? '' : 's'} voided: expected dividends now start from ${next.dividendTrackingFrom}.`,
        );
      else if (pending.length)
        notify(
          `${pending.length} expected dividend${pending.length === 1 ? '' : 's'} added from PSX announcements: ${pending.map((d) => d.ticker).join(', ')}. Mark them received once paid.`,
        );
    }
  }
  /** Persists read/cleared state of the notification list. */
  function updateNotifications(
    change: (list: AppNotification[]) => AppNotification[],
  ) {
    attempt(async () => {
      const next = clone(p!);
      next.notifications = change(next.notifications ?? []);
      await save(next, 'Notifications updated.');
    });
  }
  useEffect(() => {
    if (email) void load();
  }, [email]);
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
  async function save(
    next: Portfolio,
    success = 'Saved to your private portfolio.',
  ) {
    if (busy)
      throw Error('Wait for the current operation to finish.');
    validate(next);
    setBusy(true);
    try {
      const r = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: next, revision }),
      });
      const d = (await r.json()) as ApiResponse;
      if (!r.ok) throw Error(d.error);
      setP(next);
      setRevision(d.revision);
      notify(success);
    } catch (e) {
      notify(String(e), true);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function attempt(action: () => Promise<unknown>) {
    void action().catch((e) =>
      notify(e instanceof Error ? e.message : String(e), true),
    );
  }
  function unknownCostWarning(next: Portfolio) {
    const tickers = [
      ...new Set(
        taxSummary(next)
          .sales.filter((s) => s.costBasis === null)
          .map((s) => s.ticker),
      ),
    ];
    if (!tickers.length) return '';
    return ` Warning: ${tickers.length === 1 ? 'a sale has' : tickers.length + ' sales have'} unknown cost basis (${tickers.join(', ')}) — edit the opening trade to enter its real cost for accurate tax figures.`;
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (tool: unknown, opts: unknown) => void };
      }
    ).modelContext;
    if (!context?.registerTool || !p) return;
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
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))
              throw Error('Invalid month');
            return { holdings: holdings(p), plan: plan(p, m, fees, allowOld) };
          },
        },
        { signal: abort.signal },
      );
    } catch {}
    return () => abort.abort();
  }, [p, fees, allowOld]);
  if (!p && email && !(failed && message))
    return (
      <main className="app-loading">
        <div className="brand">
          <LogoMark size={28} />
          <Wordmark />
        </div>
        <Spinner className="size-6" />
        <p className="muted">Loading your holdings…</p>
      </main>
    );
  if (!p && !email) return <SignIn returnTo={initialPathname || '/'} />;
  if (!p)
    return <LoadError message={message} busy={busy} onRetry={load} />;
  const restoreBackup = (f: File) => {
    attempt(async () => {
    const data = JSON.parse(await f.text());
    if (
      data.kind !== 'psx-portfolio-ledger' ||
      data.schemaVersion !== 1
    )
      throw Error(
        'Choose a portfolio-ledger backup, not a company research file.',
      );
    validate(data.portfolio);
    await save(
      data.portfolio,
      'Portfolio backup restored.',
    );
    });
  };
  const importCdc = (f: File) => {
    attempt(async () => {
    const raw = JSON.parse(await f.text());
    const result = importCdcDividends(
      raw,
      p.companies,
      p.dividends ?? [],
    );
    if (!result.imported) {
      notify(
        `No dividends imported. Skipped: ${result.skippedNotPaid} not paid, ${result.skippedDuplicate} duplicate, ${result.skippedUnknownTicker} unknown ticker, ${result.skippedInvalid} invalid.`,
        true,
      );
      return;
    }
    const next = clone(p);
    const { voided: replaced, ambiguous } = supersedeAutoWithImports(
      next,
      next.dividends ?? [],
      result.dividends,
    );
    if (ambiguous.length)
      throw Error(
        `Nothing was imported: ${ambiguous.map((d) => `${d.ticker} ${d.date}`).join(', ')} could belong to more than one expected PSX dividend. Void the expected record that does not apply (Activity), then import again.`,
      );
    const superseded = replaced.length;
    const at = new Date().toISOString();
    addNotifications(next, [
      ...dividendNotifications(result.dividends, at),
      ...replaced.map(
        (d): AppNotification => ({
          id: `replaced:${d.id}`,
          at,
          kind: 'dividend-replaced',
          ticker: d.ticker,
          title: `${d.ticker} PSX estimate replaced`,
          body: `The PSX-announced dividend for ${d.date} was replaced by the actual CDC payment.`,
          read: false,
        }),
      ),
    ]);
    next.dividends = [
      ...(next.dividends ?? []),
      ...result.dividends,
    ];
    await save(
      next,
      `${result.imported} dividend${result.imported === 1 ? '' : 's'} imported${superseded ? `, replacing ${superseded} PSX auto record${superseded === 1 ? '' : 's'}` : ''}. Skipped: ${result.skippedNotPaid} not paid, ${result.skippedDuplicate} duplicate, ${result.skippedUnknownTicker} unknown ticker, ${result.skippedInvalid} invalid.`,
    );
    });
  };
  const importFinqalab = (f: File) => {
    attempt(async () => {
    if (f.type && f.type !== 'application/pdf')
      throw Error('Choose a PDF report from Finqalab.');
    const { text } = await extractPdfText(
      new Uint8Array(await f.arrayBuffer()),
    );
    const rows = parseFinqalabReport(text);
    const result = importFinqalabTrades(p, rows);
    if (!result.imported) {
      notify(
        `No Finqalab trades imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`,
        true,
      );
      return;
    }
    const next = clone(p);
    next.companies = result.companies;
    next.trades = [...next.trades, ...result.trades];
    await save(
      next,
      `${result.imported} Finqalab trade${result.imported === 1 ? '' : 's'} imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.${result.addedCompanies ? ` Added ${result.addedCompanies} unapproved compan${result.addedCompanies === 1 ? 'y' : 'ies'}.` : ''}${unknownCostWarning(next)}`,
    );
    });
  };
  const importAhl = (f: File) => {
    attempt(async () => {
    const rows = parseAhlHistory(JSON.parse(await f.text()));
    const result = importAhlTrades(p, rows);
    if (!result.imported) {
      notify(
        `No AHL trades imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`,
        true,
      );
      return;
    }
    const next = clone(p);
    next.companies = result.companies;
    for (const trade of next.trades) {
      if (result.voidedTradeIds.includes(trade.id))
        trade.voided = true;
    }
    next.trades = [...next.trades, ...result.trades];
    await save(
      next,
      `${result.imported} AHL trade${result.imported === 1 ? '' : 's'} imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.${result.voidedTradeIds.length ? ` Reconciled ${result.voidedTradeIds.length} duplicate opening balance${result.voidedTradeIds.length === 1 ? '' : 's'}.` : ''}${result.addedCompanies ? ` Added ${result.addedCompanies} unapproved compan${result.addedCompanies === 1 ? 'y' : 'ies'}.` : ''}${unknownCostWarning(next)}`,
    );
    });
  };
  const exportBackup = () =>
    download(
      `psx-portfolio-${today()}.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'psx-portfolio-ledger',
          exportedAt: new Date().toISOString(),
          portfolio: p,
        },
        null,
        2,
      ),
    );
  const saveResearchSettings = (patch: Partial<ResearchSettings>) =>
    attempt(() =>
      save(
        {
          ...p,
          researchSettings: {
            ...(p.researchSettings ?? DEFAULT_RESEARCH_SETTINGS),
            ...patch,
          },
        },
        'AI model settings saved.',
      ),
    );
  const saveFilerStatus = (filerStatus: 'filer' | 'non-filer') =>
    attempt(() =>
      save({ ...p, taxProfile: { filerStatus } }, 'Tax status saved.'),
    );
  const hs = holdings(p)
      .slice()
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1)),
    held = hs.filter((h) => h.shares > 0),
    { value, cost, gain, missingPrice: missing, unknownCost: unknown } =
      portfolioSummary(hs);
  const newBuys = round(
    p.trades
      .filter((t) => t.kind === 'buy' && !t.voided)
      .reduce((a, t) => a + t.shares * t.price! + t.fees, 0),
  );
  const soldOut = hs.filter(
      (h) =>
        h.shares === 0 &&
        p.trades.some(
          (t) => t.ticker === h.ticker && t.kind === 'buy' && !t.voided,
        ),
    ),
    sectorsInUse = Array.from(
      new Set(hs.map((h) => h.sector).filter((s): s is string => !!s)),
    ),
    rowsBase = showSoldOut ? held.concat(soldOut) : held,
    rowsFiltered = !sectorFilter
      ? rowsBase
      : sectorFilter === SHORTLISTED
        ? rowsBase.filter((h) => h.target > 0)
        : rowsBase.filter((h) => h.sector === sectorFilter),
    holdingsSortAccessor: Record<
      HoldingsSortKey,
      (h: (typeof hs)[number]) => number | string
    > = {
      name: (h) => h.name || h.ticker,
      shares: (h) => h.shares,
      average: (h) => h.average ?? -Infinity,
      price: (h) => h.quote?.price ?? -Infinity,
      value: (h) => h.value ?? -Infinity,
      gain: (h) => h.gain ?? -Infinity,
      weight: (h) => (value > 0 ? (h.value ?? 0) / value : -Infinity),
    },
    displayedHoldings = holdingsSort
      ? rowsFiltered.slice().sort((a, b) => {
          const acc = holdingsSortAccessor[holdingsSort.key],
            av = acc(a),
            bv = acc(b),
            cmp =
              typeof av === 'string'
                ? av.localeCompare(bv as string)
                : (av as number) - (bv as number);
          return holdingsSort.dir === 'asc' ? cmp : -cmp;
        })
      : rowsFiltered;
  function toggleHoldingsSort(key: HoldingsSortKey) {
    setHoldingsSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
  }
  const gainPct = (h: (typeof hs)[number]) =>
    h.gain !== null && h.cost !== null && h.cost > 0
      ? (h.gain / h.cost) * 100
      : null;
  const gainText = (h: (typeof hs)[number]) => {
    const pct = gainPct(h);
    return pct === null
      ? ''
      : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
  };
  const gainClass = (h: (typeof hs)[number]) =>
    h.gain === null ? undefined : h.gain >= 0 ? 'pos-text' : 'neg-text';
  const openQuoteEntry = (h: (typeof hs)[number]) => {
    setQuoteTicker(h.ticker);
    setQuotePrice(h.quote?.price.toString() ?? '');
    setQuoteDate(h.quote?.date ?? today());
  };
  const holdingActions = (h: (typeof hs)[number]) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="secondary compact icon-btn"
        aria-label={`Actions for ${h.ticker}`}
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => openCompany(h.ticker)}
        >
          View company
        </DropdownMenuItem>
        {h.shares > 0 && (
          <DropdownMenuItem
            onClick={() =>
              openTx('sell', h.ticker, h.quote?.price ?? null)
            }
          >
            Sell
          </DropdownMenuItem>
        )}
        {h.shares > 0 && (
          <DropdownMenuItem
            onClick={() => openTx('dividend', h.ticker)}
          >
            Dividend
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            setCreatingCompany(false);
            setCompany({
              ...p.companies.find(
                (c) => c.ticker === h.ticker,
              )!,
            });
          }}
        >
          Edit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  function sortIndicator(key: HoldingsSortKey) {
    if (!holdingsSort || holdingsSort.key !== key) return null;
    return holdingsSort.dir === 'asc' ? ' ▲' : ' ▼';
  }
  const allNotifications = p.notifications ?? [];
  const notifications = allNotifications.filter((n) => !n.clearedAt);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const chromeless =
    tab === 'settings' || tab === 'company' || tab === 'notifications';
  const taxedDividends = taxSummary(p).dividends;
  const ledgerEntries = (ticker: string | undefined) =>
    buildEntries({
      trades: p.trades.filter((t) => !ticker || t.ticker === ticker),
      dividends: (p.dividends ?? []).filter((d) => !ticker || d.ticker === ticker),
      splits: (p.stockSplits ?? []).filter((x) => !ticker || x.ticker === ticker),
      taxed: taxedDividends,
      onCorrectTrade: correctTrade,
      onCorrectDividend: correctDividend,
      onCorrectSplit: correctStockSplit,
      onConfirmDividend: openReceipt,
    });
  const companySummary = (ticker: string) => {
    const h = hs.find((x) => x.ticker === ticker);
    const div = taxedDividends.filter((d) => d.ticker === ticker && d.status === 'received');
    const dividendGross = round(div.reduce((a, d) => a + d.grossAmount, 0));
    const dividendNet = div.some((d) => d.netAmount === null)
      ? null
      : round(div.reduce((a, d) => a + (d.netAmount ?? 0), 0));
    return {
      cost: h?.cost ?? null,
      value: h?.value ?? null,
      gain: h?.gain ?? null,
      gainPercent:
        h?.gain !== null && h?.gain !== undefined && h.cost
          ? round((h.gain / h.cost) * 100)
          : null,
      dividendGross,
      dividendNet,
    };
  };
  function openCompany(ticker: string) {
    setCompanyTicker(ticker);
    const path = '/company/' + encodeURIComponent(ticker);
    setTabState('company');
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    window.scrollTo({ top: 0 });
  }
  /** Opens the one Add transaction dialog, preset to a type and (optionally) a company. */
  function openTx(type: TxType, ticker = '', price: number | null = null) {
    setEditing(null);
    setEditingDividend(null);
    setEditingStockSplit(null);
    setTxType(type);
    setTxCompany({ name: '', sector: '' });
    setTrade(
      blankTrade(ticker, type === 'sell' || type === 'opening' ? type : 'buy', price),
    );
    setDividend(blankDividend(ticker));
    setStockSplit(blankStockSplit(ticker));
  }
  /** Monthly Picks "Record these buys": walks the dialog through each priced pick in turn. */
  function openPick(queue: PickQueue, index: number) {
    const pick = queue.picks[index];
    if (!pick) {
      setPickQueue(null);
      closeTx();
      return;
    }
    setPickQueue({ ...queue, index });
    openTx('buy', pick.ticker, pick.price);
    setTrade((t) => t && { ...t, shares: pick.shares, month: queue.month });
  }
  function recordPicks(picks: PickBuy[], pickMonth: string) {
    const valid = picks.filter((x) => x.price !== null && x.price > 0 && x.shares > 0);
    if (valid.length) openPick({ picks: valid, month: pickMonth, index: 0 }, 0);
  }
  function closeTx() {
    setTrade(null);
    setDividend(null);
    setStockSplit(null);
    setEditing(null);
    setEditingDividend(null);
    setEditingStockSplit(null);
  }
  /** Keeps the fields every type shares (company, date, note) in step across the forms. */
  function patchTx(patch: { ticker?: string; date?: string; note?: string }) {
    setTrade((x) => x && { ...x, ...patch });
    setDividend((x) => x && { ...x, ...patch });
    setStockSplit((x) => x && { ...x, ...patch });
  }
  function switchTx(next: TxType) {
    if (!p) return;
    setTxType(next);
    if (next === 'buy' || next === 'sell' || next === 'opening') {
      setTrade(
        (t) =>
          t && {
            ...t,
            kind: next,
            month: next === 'buy' ? today().slice(0, 7) : '',
            price:
              next === 'sell'
                ? (t.price ?? p.quotes[t.ticker]?.price ?? null)
                : t.price,
          },
      );
    }
    if (
      next !== 'buy' &&
      next !== 'opening' &&
      !p.companies.some((c) => c.ticker === trade?.ticker)
    )
      patchTx({ ticker: '' });
  }
  function correctTrade(t: Trade) {
    setEditing(t.id);
    setTxType(t.kind);
    setTrade({ ...t });
  }
  function correctDividend(d: Dividend) {
    setEditingDividend(d.id);
    setTxType('dividend');
    setDividend(
      d.source === 'auto'
        ? {
            ...d,
            source: 'manual',
            externalId: undefined,
            status: undefined,
            entitlementDate: undefined,
            entitlementCertain: undefined,
            paymentDate: undefined,
          }
        : { ...d },
    );
  }
  function openReceipt(d: Dividend) {
    setReceipt({ dividend: d, paymentDate: today(), gross: '', tax: '' });
  }
  async function confirmReceipt(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!receipt) return;
    const next = clone(p!);
    const target = next.dividends?.find((d) => d.id === receipt.dividend.id);
    if (!target) return;
    const gross = receipt.gross.trim() === '' ? undefined : Number(receipt.gross);
    const tax = receipt.tax.trim() === '' ? undefined : Number(receipt.tax);
    if ((gross !== undefined && !(gross >= 0)) || (tax !== undefined && !(tax >= 0)))
      throw Error('Enter amounts as positive numbers, or leave them blank.');
    Object.assign(
      target,
      confirmDividendReceipt(target, {
        paymentDate: receipt.paymentDate,
        grossAmount: gross,
        taxWithheld: tax,
      }),
    );
    await save(next, `${target.ticker} dividend marked as received.`);
    setReceipt(null);
  }
  function correctStockSplit(entry: StockSplit) {
    setEditingStockSplit(entry.id);
    setTxType('split');
    setStockSplit({ ...entry });
  }
  async function refresh() {
    setBusy(true);
    try {
      notify('Fetching PSX prices…');
      void pulseRef.current?.refresh();
      const r = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: p!.companies.map((c) => c.ticker) }),
      });
      const d = (await r.json()) as QuoteRefreshResponse;
      if (!r.ok) throw Error(d.error);
      // A stale cached quote must not replace one the ledger already holds, and
      // an older or same-day PSX price never replaces a newer or manual quote.
      const fresh = Object.fromEntries(
        Object.entries(d.quotes).filter(
          ([ticker, quote]) =>
            isValidQuote(quote) &&
            !(d.stale?.[ticker] && p!.quotes[ticker]) &&
            quoteSupersedes(quote, p!.quotes[ticker]),
        ),
      );
      const next = { ...p!, quotes: { ...p!.quotes, ...fresh } };
      validate(next);
      const s = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: next, revision }),
      });
      const saved = (await s.json()) as ApiResponse;
      if (!s.ok) throw Error(saved.error);
      setP(next);
      setRevision(saved.revision);
      const stale = Object.keys(d.stale ?? {});
      notify(
        `${Object.keys(d.quotes).length - stale.length} PSX prices up to date.${stale.length ? ` Last saved price kept for ${stale.join(', ')} (${[...new Set(Object.values(d.stale ?? {}))].join(' | ')}).` : ''}${d.errors.length ? ' Unavailable: ' + d.errors.join(', ') + '. Previous quotes retained.' + (d.reasons ? ' Reason: ' + [...new Set(Object.values(d.reasons))].join(' | ') : '') : ''}`,
        !!d.errors.length || !!stale.length,
      );
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!trade) return;
    if (!trade.ticker) throw Error('Choose a company first.');
    const next = clone(p!);
    const isNew = !next.companies.some((c) => c.ticker === trade.ticker);
    if (isNew) {
      if (!/^[A-Z0-9]{2,12}$/.test(trade.ticker))
        throw Error('Enter a valid PSX symbol (2-12 letters or digits).');
      next.quotes[trade.ticker] = await verifyPsxSymbol(trade.ticker);
      next.companies.push({
        ticker: trade.ticker,
        name: txCompany.name.trim(),
        sector: txCompany.sector,
        target: 0,
        approved: false,
        screenDate: '',
        note: '',
      });
    }
    if (editing) {
      const old = next.trades.find((t) => t.id === editing);
      if (old) old.voided = true;
    }
    const entry = { ...trade, id: crypto.randomUUID() };
    if (editing) {
      const index = next.trades.findIndex((t) => t.id === editing);
      next.trades.splice(index + 1, 0, entry);
    } else next.trades.push(entry);
    await save(
      next,
      editing
        ? 'Correction saved. Previous entry retained as voided.'
        : `${isNew ? `${trade.ticker} confirmed on PSX and added to your companies. ` : ''}Transaction saved as a new line item. Holdings and average cost updated.`,
    );
    closeTx();
    if (pickQueue && !editing) openPick(pickQueue, pickQueue.index + 1);
  }
  async function recordStockSplit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!stockSplit) return;
    if (!p!.companies.some((c) => c.ticker === stockSplit.ticker))
      throw Error('Choose a company you own.');
    const next = clone(p!);
    next.stockSplits ??= [];
    if (editingStockSplit) {
      const old = next.stockSplits.find(
        (entry) => entry.id === editingStockSplit,
      );
      if (old) old.voided = true;
    }
    const entry = { ...stockSplit, id: crypto.randomUUID() };
    if (editingStockSplit) {
      const index = next.stockSplits.findIndex(
        (item) => item.id === editingStockSplit,
      );
      next.stockSplits.splice(index + 1, 0, entry);
    } else next.stockSplits.push(entry);
    await save(
      next,
      editingStockSplit
        ? 'Stock split correction saved. Previous entry retained as voided.'
        : 'Stock split saved. Shares and average costs were recalculated.',
    );
    closeTx();
  }
  async function recordDividend(e: React.FormEvent) {
    e.preventDefault();
    if (!dividend) return;
    if (!p!.companies.some((c) => c.ticker === dividend.ticker))
      throw Error('Choose a company you own.');
    const next = clone(p!);
    next.dividends = next.dividends ?? [];
    if (editingDividend) {
      const old = next.dividends.find((d) => d.id === editingDividend);
      if (old) old.voided = true;
    }
    const entry: Dividend = {
      ...dividend,
      id: crypto.randomUUID(),
      grossAmount: round(
        (dividend.perShare ?? 0) *
          sharesHeldOn(next, dividend.ticker, dividend.date),
      ),
    };
    if (editingDividend) {
      const index = next.dividends.findIndex((d) => d.id === editingDividend);
      next.dividends.splice(index + 1, 0, entry);
    } else next.dividends.push(entry);
    addNotifications(
      next,
      dividendNotifications([entry], new Date().toISOString()),
    );
    await save(
      next,
      editingDividend
        ? 'Correction saved. Previous dividend record retained as voided.'
        : 'Dividend recorded.',
    );
    closeTx();
  }
  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    const next = clone(p!);
    const at = next.companies.findIndex((c) => c.ticker === company.ticker);
    if (creatingCompany) {
      if (at >= 0) throw Error(`${company.ticker} is already in your portfolio.`);
      const quote = await verifyPsxSymbol(company.ticker);
      next.quotes[company.ticker] = quote;
    }
    if (at >= 0) next.companies[at] = company;
    else next.companies.push(company);
    await save(
      next,
      creatingCompany
        ? `${company.ticker} confirmed on PSX and added to your portfolio.`
        : undefined,
    );
    setCompany(null);
    setCreatingCompany(false);
  }
  return (
    <CompanyNavProvider value={openCompany}>
    <main className="desk">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <header className={'app-header' + (chromeless ? ' no-tabs' : '')}>
        <button
          type="button"
          data-slot="brand"
          className="brand"
          onClick={() => setTab('holdings')}
        >
          <LogoMark size={28} />
          <Wordmark />
        </button>
        <div className="header-right">
          <button
            type="button"
            data-slot="hdr"
            className="hdr-btn"
            disabled={busy}
            aria-label="Refresh PSX prices"
            onClick={refresh}
          >
            <RefreshCw size={18} />
            <span className="hdr-label">Refresh PSX prices</span>
          </button>
          <button
            type="button"
            data-slot="hdr"
            className="hdr-btn"
            disabled={busy}
            aria-label="Add transaction"
            onClick={() =>
              openTx('buy', tab === 'company' ? companyTicker : '')
            }
          >
            <Plus size={18} />
            <span className="hdr-label">Add transaction</span>
          </button>
          <Popover
            open={bellOpen}
            onOpenChange={(next) => {
              // Phones skip the popover (it can't fit): go straight to the page.
              if (next && window.matchMedia('(max-width:760px)').matches) {
                setTab('notifications');
                return;
              }
              setBellOpen(next);
            }}
          >
            <PopoverTrigger
              className="bell-trigger hdr-btn"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
            >
              <Bell size={18} />
              <span className="hdr-label">Notifications</span>
              {unreadCount > 0 && (
                <span className="bell-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="notice-panel">
              <div className="notice-head">
                <strong>Notifications</strong>
                <span className="row">
                  <button
                    type="button"
                    data-slot="link"
                    className="link-button"
                    disabled={busy || !unreadCount}
                    onClick={() =>
                      updateNotifications((list) =>
                        list.map((n) => ({ ...n, read: true })),
                      )
                    }
                  >
                    Mark all read
                  </button>
                  <button
                    type="button"
                    data-slot="link"
                    className="link-button"
                    disabled={busy || !notifications.length}
                    onClick={() => {
                      const at = new Date().toISOString();
                      updateNotifications((list) =>
                        list.map((n) =>
                          n.clearedAt ? n : { ...n, read: true, clearedAt: at },
                        ),
                      );
                    }}
                  >
                    Clear
                  </button>
                </span>
              </div>
              {notifications.length === 0 ? (
                <p className="muted notice-empty">
                  Nothing yet. Dividends recorded from PSX announcements and
                  new payout announcements for your holdings appear here.
                </p>
              ) : (
                <ul className="notice-list">
                  {notifications.map((n) => (
                    <li key={n.id} className={n.read ? '' : 'unread'}>
                      <button
                        type="button"
                        data-slot="link"
                        className="notice-item"
                        onClick={() => {
                          if (!n.read)
                            updateNotifications((list) =>
                              list.map((x) =>
                                x.id === n.id ? { ...x, read: true } : x,
                              ),
                            );
                        }}
                      >
                        <strong>{n.title}</strong>
                        <span>{n.body}</span>
                        <small>{new Date(n.at).toLocaleString()}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="notice-foot">
                <button
                  type="button"
                  data-slot="link"
                  className="link-button"
                  onClick={() => {
                    setBellOpen(false);
                    setTab('notifications');
                  }}
                >
                  View all notifications
                </button>
              </div>
            </PopoverContent>
          </Popover>
          {email && (
            <DropdownMenu>
              <DropdownMenuTrigger className="account-trigger">
                <UserAvatar name={name} email={email} picture={picture} />
                <ChevronDown size={14} className="account-chevron" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="account-menu">
                <div className="account-menu-header">
                  <UserAvatar
                    name={name}
                    email={email}
                    picture={picture}
                    large
                  />
                  <div>
                    {name && <span className="account-menu-name">{name}</span>}
                    <span className="account-menu-email">{email}</span>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTab('settings')}>
                  <Settings size={15} /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    window.location.href = '/api/auth/logout';
                  }}
                >
                  <LogOut size={15} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!chromeless && (
          <TabsList variant="line">
            <TabsTrigger value="holdings">
              <Wallet className="tab-icon" aria-hidden="true" />
              <span className="tab-long">Holdings</span>
              <span className="tab-short">Holdings</span>
            </TabsTrigger>
            <TabsTrigger value="reports">
              <BarChart3 className="tab-icon" aria-hidden="true" />
              <span className="tab-long">Reports</span>
              <span className="tab-short">Reports</span>
            </TabsTrigger>
            <TabsTrigger value="history">
              <ScrollText className="tab-icon" aria-hidden="true" />
              <span className="tab-long">Activity</span>
              <span className="tab-short">Activity</span>
            </TabsTrigger>
            <TabsTrigger value="sip">
              <Sparkles className="tab-icon" aria-hidden="true" />
              <span className="tab-long">Monthly Picks</span>
              <span className="tab-short">Picks</span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="research-desk">
                <FlaskConical className="tab-icon" aria-hidden="true" />
                <span className="tab-long">Research desk</span>
                <span className="tab-short">Research</span>
              </TabsTrigger>
            )}
          </TabsList>
        )}
      </header>
        <TabsContent value="holdings">
          {p.companies.length === 0 ? (
            <div className="panel empty-holdings">
              <h2>No holdings yet</h2>
              <p>Record your first purchase to start tracking your portfolio.</p>
              <button disabled={busy} onClick={() => openTx('buy')}>
                <Plus size={16} /> Add your first transaction
              </button>
            </div>
          ) : (
          <>
          <PortfolioValueCard
            p={p}
            value={value}
            cost={cost}
            gain={gain}
            heldCount={held.length}
            missingCount={missing.length}
            unknownCount={unknown.length}
            newBuys={newBuys}
            aside={widePulse ? <PsxMarketPulse ref={pulseRef} onOpenShortlist={() => setTab('sip')} /> : undefined}
          />
          <div className="holdings-head">
            <h2>
              Your companies
              <span className="count-badge">
                {held.length} {held.length === 1 ? 'holding' : 'holdings'}
              </span>
            </h2>
            <button
              className="secondary compact holdings-add holdings-targets"
              disabled={busy}
              onClick={() => setTargetsOpen(true)}
            >
              Targets
            </button>
            <button
              className="secondary compact holdings-add"
              disabled={busy}
              aria-label="Add company"
              onClick={() => {
                setCreatingCompany(true);
                setCompany({
                  ticker: '',
                  name: '',
                  sector: '',
                  target: 0,
                  approved: false,
                  screenDate: '',
                  note: '',
                });
              }}
            >
              <Plus size={15} /> <span className="holdings-add__label">Add company</span>
            </button>
            <select
              className="holdings-filter"
              aria-label="Filter companies"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
            >
              <option value="">All sectors</option>
              <option value={SHORTLISTED}>Shortlisted only</option>
              {sectorsInUse.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
            <div className="holdings-sort">
              <select
                aria-label="Sort holdings"
                value={holdingsSort?.key ?? ''}
                onChange={(e) => {
                  const key = e.target.value as HoldingsSortKey | '';
                  if (!key) setHoldingsSort(null);
                  else if (holdingsSort?.key !== key) toggleHoldingsSort(key);
                }}
              >
                <option value="">Sort: market value</option>
                {(
                  [
                    ['name', 'Company'],
                    ['value', 'Market value'],
                    ['gain', 'Gain / loss'],
                    ['shares', 'Shares'],
                    ['average', 'Avg. cost'],
                    ['price', 'Latest price'],
                    ['weight', 'Portfolio weight'],
                  ] as [HoldingsSortKey, string][]
                ).map(([key, label]) => (
                  <option key={key} value={key}>
                    Sort: {label}
                  </option>
                ))}
              </select>
              {holdingsSort && (
                <button
                  type="button"
                  className="secondary compact"
                  aria-label="Reverse sort order"
                  onClick={() => toggleHoldingsSort(holdingsSort.key)}
                >
                  {holdingsSort.dir === 'asc' ? '▲' : '▼'}
                </button>
              )}
            </div>
            {soldOut.length > 0 && (
              <label className="check-row holdings-soldout">
                <Checkbox
                  checked={showSoldOut}
                  onCheckedChange={(v) => setShowSoldOut(!!v)}
                />{' '}
                Show sold out ({soldOut.length})
              </label>
            )}
          </div>
          <div className="holdings-cards">
            {displayedHoldings.map((h) => (
              <article className="holding-card" key={h.ticker}>
                <div className="holding-card__head">
                  <button
                    type="button"
                    className="holding-card__title"
                    onClick={() => openCompany(h.ticker)}
                  >
                    <b className="ticker">
                      {h.ticker}
                    </b>
                    <small>{h.name}</small>
                  </button>
                  {holdingActions(h)}
                </div>
                <dl className="holding-card__grid">
                  <div>
                    <dt>Value</dt>
                    <dd className="amount">
                      {h.value === null ? '—' : moneyShort(h.value)}
                    </dd>
                  </div>
                  <div>
                    <dt>Gain</dt>
                    <dd className={gainClass(h)}>
                      {h.gain === null ? '—' : moneyShort(h.gain)}
                      {gainPct(h) !== null && <small>{gainText(h)}</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>Shares @ avg cost</dt>
                    <dd>
                      {h.shares.toLocaleString()}
                      <small>
                        @ {h.average === null ? '—' : money(h.average)}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>
                      <button
                        type="button"
                        className="quote-btn"
                        onClick={() => openQuoteEntry(h)}
                      >
                        {h.quote ? money(h.quote.price) : 'Add price'}
                      </button>
                      {h.quote && (
                        <small>
                          {h.quote.date}
                          {h.quote.manual ? ' · manual' : ''}
                          {h.quote.date !== today() ? ' · older quote' : ''}
                        </small>
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <section className="panel table-panel holdings-table">
            <Table>
              <TableHeader>
                <TableRow>
                  {(
                    [
                      ['name', 'Company'],
                      ['shares', 'Shares'],
                      ['average', 'Avg. cost'],
                      ['price', 'Latest price'],
                      ['value', 'Market value'],
                      ['gain', 'Gain / loss'],
                      ['weight', 'Portfolio weight'],
                    ] as [HoldingsSortKey, string][]
                  ).map(([key, label]) => (
                    <TableHead key={key}>
                      <button
                        type="button"
                        className="sort-head"
                        onClick={() => toggleHoldingsSort(key)}
                      >
                        {label}
                        {sortIndicator(key)}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedHoldings.map((h) => (
                  <TableRow key={h.ticker}>
                    <TableCell>
                      <button
                        className="quote-btn ticker"
                        onClick={() => openCompany(h.ticker)}
                      >
                        {h.ticker}
                      </button>
                      {h.target > 0 && (
                        <span
                          className="shortlist-dot"
                          title="On SIP shortlist"
                          aria-label="On SIP shortlist"
                        />
                      )}
                      <small>
                        {h.name}
                        {h.sector ? ` · ${h.sector}` : ''}
                      </small>
                      {h.target > 0 && (
                        <span
                          className="shortlist-dot"
                          title="On SIP shortlist"
                          aria-label="On SIP shortlist"
                        />
                      )}
                    </TableCell>
                    <TableCell className="amount">
                      {h.shares.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {h.average === null ? '—' : money(h.average)}
                    </TableCell>
                    <TableCell>
                      <button
                        className="quote-btn"
                        onClick={() => {
                          setQuoteTicker(h.ticker);
                          setQuotePrice(h.quote?.price.toString() ?? '');
                          setQuoteDate(h.quote?.date ?? today());
                        }}
                      >
                        {h.quote ? money(h.quote.price) : 'Add price'}
                      </button>
                      {h.quote && (
                        <small>
                          {h.quote.date}
                          {h.quote.manual ? ' · manual' : ''}
                          {h.quote.date !== today() ? ' · older quote' : ''}
                        </small>
                      )}
                    </TableCell>
                    <TableCell>
                      {h.value === null ? '—' : moneyShort(h.value)}
                    </TableCell>
                    <TableCell className={gainClass(h)}>
                      {h.gain === null ? '—' : moneyShort(h.gain)}
                      {gainPct(h) !== null && <small>{gainText(h)}</small>}
                    </TableCell>
                    <TableCell>
                      {!missing.length && value > 0 ? (
                        <>
                          <span>
                            {(((h.value ?? 0) / value) * 100).toFixed(1)}%
                          </span>
                          <div className="bar">
                            <i
                              style={{
                                width: `${((h.value ?? 0) / value) * 100}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {holdingActions(h)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="table-note">
              A dash means unknown, not zero. Quotes may be delayed. Market
              values exclude cash and unrecorded corporate actions.
            </p>
          </section>
          {widePulse === false && <PsxMarketPulse ref={pulseRef} onOpenShortlist={() => setTab('sip')} />}
          </>
          )}
        </TabsContent>
        <TabsContent value="reports">
          <PortfolioReports portfolio={p} />
        </TabsContent>
        <TabsContent value="sip">
          <MonthlyPicks
            portfolio={p}
            month={month}
            setMonth={setMonth}
            feePct={fees}
            setFeePct={setFees}
            busy={busy}
            onSave={save}
            onRecordBuys={recordPicks}
            onRefreshPrices={refresh}
            onOpenCompany={openCompany}
            onManualPrice={(ticker) => {
              setQuoteTicker(ticker);
              setQuotePrice(String(p.quotes[ticker]?.price ?? ''));
              setQuoteDate(p.quotes[ticker]?.date ?? today());
            }}
          />
        </TabsContent>
        <TabsContent value="history">
          <div className="activity-head">
            <h2>Activity</h2>
            <button
              className="compact"
              disabled={busy}
              onClick={() => openTx('buy')}
            >
              <Plus size={15} /> Add transaction
            </button>
            <p>Every buy, sale, dividend and split, newest first.</p>
          </div>
          <LedgerTimeline
            portfolio={p}
            entries={ledgerEntries(undefined)}
            onOpenCompany={openCompany}
          />
        </TabsContent>
        <TabsContent value="company">
          {companyTicker && (
            <CompanyDetail
              portfolio={p}
              ticker={companyTicker}
              holding={hs.find((h) => h.ticker === companyTicker)}
              summary={companySummary(companyTicker)}
              taxed={taxedDividends}
              busy={busy}
              onBack={() => setTab('holdings')}
              onAddPurchase={() => openTx('buy', companyTicker)}
              onSell={() =>
                openTx(
                  'sell',
                  companyTicker,
                  hs.find((h) => h.ticker === companyTicker)?.quote?.price ?? null,
                )
              }
              onDividend={() => openTx('dividend', companyTicker)}
              onSplit={() => openTx('split', companyTicker)}
              onEdit={() => {
                const c = p.companies.find((x) => x.ticker === companyTicker);
                if (!c) return;
                setCreatingCompany(false);
                setCompany({ ...c });
              }}
              onCorrectTrade={correctTrade}
              onCorrectDividend={correctDividend}
              onCorrectSplit={correctStockSplit}
              onConfirmDividend={openReceipt}
            />
          )}
        </TabsContent>
        {isAdmin && (
          <TabsContent value="research-desk">
            <ResearchDesk
              portfolio={p}
              onSave={save}
              onOpenSettings={() => setTab('settings')}
            />
          </TabsContent>
        )}
        <TabsContent value="settings">
          <SettingsView
            name={name}
            email={email!}
            picture={picture}
            role={role}
            busy={busy}
            usage={usage}
            filerStatus={p.taxProfile?.filerStatus ?? ''}
            researchSettings={p.researchSettings ?? DEFAULT_RESEARCH_SETTINGS}
            onBack={() => setTab('holdings')}
            onFilerStatus={saveFilerStatus}
            onResearchSettings={saveResearchSettings}
            onExport={exportBackup}
            onRestore={restoreBackup}
            onImportCdc={importCdc}
            onImportFinqalab={importFinqalab}
            onImportAhl={importAhl}
          />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsView
            notifications={allNotifications}
            busy={busy}
            onChange={updateNotifications}
            onBack={() => setTab('holdings')}
          />
        </TabsContent>
      </Tabs>
      <footer>
        <div className="row">
          <span>All amounts in PKR · Private saved ledger</span>
        </div>
      </footer>
      {confirmDialog}
      <Dialog
        open={!!(trade || dividend || stockSplit)}
        onOpenChange={(open) => {
          if (!open) {
            setPickQueue(null);
            closeTx();
          }
        }}
      >
        <DialogContent className="form-dialog tx-dialog">
          {(() => {
            const correcting = !!(editing || editingDividend || editingStockSplit);
            const t = trade,
              d = dividend,
              sp = stockSplit;
            const ticker =
              txType === 'dividend' ? d?.ticker : txType === 'split' ? sp?.ticker : t?.ticker;
            const owned = !!ticker && p.companies.some((c) => c.ticker === ticker);
            const isTrade = txType === 'buy' || txType === 'sell' || txType === 'opening';
            const addNew =
              !correcting && isTrade && txType !== 'sell' && !!ticker && !owned &&
              /^[A-Z0-9]{2,12}$/.test(ticker);
            const date = (isTrade ? t?.date : txType === 'dividend' ? d?.date : sp?.date) ?? '';
            const sectors = Array.from(new Set([...SECTORS, ...sectorsInUse])).sort();
            const title = correcting
              ? txType === 'dividend'
                ? 'Correct dividend'
                : txType === 'split'
                  ? 'Correct stock split'
                  : 'Correct transaction'
              : 'Add transaction';
            const description = {
              buy: 'Record the shares and actual price from your broker confirmation.',
              sell: 'Record the shares and actual price from your broker confirmation.',
              opening:
                'Enter the original average purchase cost if known. The statement date remains the opening snapshot date.',
              dividend:
                'Enter the per-share amount from your dividend notice. The gross amount is computed from the shares you held on the payment date.',
              split:
                'A split or bonus issue changes the number of shares held before its effective date. Total purchase cost stays unchanged. A 1 for 4 bonus is 4 old shares becoming 5 new.',
            }[txType];
            const voidEntry = async () => {
              const ok = () =>
                confirm({
                  title: `Void this ${editing ? 'entry' : editingDividend ? 'dividend record' : 'stock split'}?`,
                  description: 'Its audit record will remain.',
                  confirmLabel: 'Void',
                  destructive: true,
                });
              if (editing) {
                if (!(await ok())) return;
                attempt(async () => {
                  const next = clone(p);
                  next.trades.find((x) => x.id === editing)!.voided = true;
                  await save(next, 'Entry voided.');
                  closeTx();
                });
              } else if (editingDividend) {
                if (!(await ok())) return;
                attempt(async () => {
                  const next = clone(p);
                  next.dividends!.find((x) => x.id === editingDividend)!.voided = true;
                  await save(next, 'Dividend record voided.');
                  closeTx();
                });
              } else if (editingStockSplit) {
                if (!(await ok())) return;
                attempt(async () => {
                  const next = clone(p);
                  next.stockSplits!.find((x) => x.id === editingStockSplit)!.voided = true;
                  await save(next, 'Stock split voided.');
                  closeTx();
                });
              }
            };
            return (
              <>
                <DialogTitle>{pickQueue ? `Pick ${pickQueue.index + 1} of ${pickQueue.picks.length} · ${title}` : title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
                <form
                  onSubmit={(e) =>
                    attempt(() =>
                      txType === 'dividend'
                        ? recordDividend(e)
                        : txType === 'split'
                          ? recordStockSplit(e)
                          : record(e),
                    )
                  }
                >
                  {!correcting && (
                    <fieldset className="tx-types">
                      <legend className="sr-only">Transaction type</legend>
                      {TX_TYPES.map((x) => (
                        <button
                          key={x.type}
                          type="button"
                          aria-pressed={txType === x.type}
                          className={txType === x.type ? 'compact' : 'secondary compact'}
                          onClick={() => switchTx(x.type)}
                        >
                          {x.label}
                        </button>
                      ))}
                    </fieldset>
                  )}
                  <div className="form-grid">
                    <div className="wide tx-field">
                      <span>Company</span>
                      <TickerPicker
                        key={txType}
                        value={ticker ?? ''}
                        companies={p.companies}
                        allowNew={!correcting && isTrade && txType !== 'sell'}
                        disabled={correcting && !isTrade}
                        onChange={(v) => patchTx({ ticker: v })}
                      />
                    </div>
                    {addNew && (
                      <div className="wide tx-newco">
                        <p>
                          <b>Add {ticker} to your companies</b>
                          <span>
                            {' '}
                            It is not in your portfolio yet. The symbol is checked against PSX
                            when you save, then the company and this entry are saved together.
                          </span>
                        </p>
                        <div className="form-grid">
                          <label>
                            Company name
                            <input
                              required
                              maxLength={150}
                              value={txCompany.name}
                              onChange={(e) =>
                                setTxCompany({ ...txCompany, name: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Sector
                            <select
                              required
                              value={txCompany.sector}
                              onChange={(e) =>
                                setTxCompany({ ...txCompany, sector: e.target.value })
                              }
                            >
                              <option value="" disabled>
                                Select sector
                              </option>
                              {sectors.map((sector) => (
                                <option key={sector} value={sector}>
                                  {sector}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}
                    <label>
                      {txType === 'opening'
                        ? 'Opening snapshot date'
                        : txType === 'dividend'
                          ? 'Payment date'
                          : txType === 'split'
                            ? 'Effective date'
                            : 'Trade date'}
                      <input
                        type="date"
                        max={today()}
                        required
                        value={date}
                        onChange={(e) => patchTx({ date: e.target.value })}
                      />
                    </label>
                    {isTrade && t && (
                      <>
                        <label>
                          Number of shares
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            required
                            value={t.shares || ''}
                            onChange={(e) => setTrade({ ...t, shares: Number(e.target.value) })}
                          />
                        </label>
                        <label>
                          {txType === 'opening'
                            ? 'Average cost per share (optional)'
                            : 'Price per share (PKR)'}
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.0001"
                            step="any"
                            required={txType !== 'opening'}
                            value={t.price ?? ''}
                            onChange={(e) =>
                              setTrade({
                                ...t,
                                price: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Fees (PKR)
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder="0"
                            value={t.fees || ''}
                            onChange={(e) => setTrade({ ...t, fees: Number(e.target.value) })}
                          />
                        </label>
                        {txType === 'buy' && (
                          <label>
                            SIP month (optional)
                            <input
                              type="month"
                              value={t.month}
                              onChange={(e) => setTrade({ ...t, month: e.target.value })}
                            />
                          </label>
                        )}
                      </>
                    )}
                    {txType === 'dividend' && d && (
                      <label>
                        Dividend per share (PKR)
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          required
                          value={d.perShare || ''}
                          onChange={(e) => setDividend({ ...d, perShare: Number(e.target.value) })}
                        />
                      </label>
                    )}
                    {txType === 'split' && sp && (
                      <>
                        <label>
                          Old shares
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            required
                            placeholder="e.g. 4"
                            value={sp.oldShares || ''}
                            onChange={(e) =>
                              setStockSplit({ ...sp, oldShares: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          New shares
                          <input
                            type="number"
                            inputMode="numeric"
                            min={sp.oldShares + 1}
                            step="1"
                            required
                            placeholder="e.g. 5"
                            value={sp.newShares || ''}
                            onChange={(e) =>
                              setStockSplit({ ...sp, newShares: Number(e.target.value) })
                            }
                          />
                        </label>
                      </>
                    )}
                    <label className="wide">
                      Note
                      <textarea
                        maxLength={2000}
                        placeholder={
                          txType === 'split'
                            ? 'For example: 25% bonus, or face value changed from PKR 10 to PKR 2.'
                            : undefined
                        }
                        value={(isTrade ? t?.note : txType === 'dividend' ? d?.note : sp?.note) ?? ''}
                        onChange={(e) => patchTx({ note: e.target.value })}
                      />
                    </label>
                  </div>
                  {isTrade && t && (
                    <p>
                      {txType === 'opening' && t.price === null
                        ? 'Cost remains unknown.'
                        : t.shares > 0 && t.price !== null
                          ? `Cash ${txType === 'sell' ? 'received' : txType === 'opening' ? 'cost' : 'invested'}: ${money(t.shares * t.price + (txType === 'sell' ? -t.fees : t.fees))}${t.fees ? ' incl. fees' : ''}`
                          : 'Enter shares and price to see the cash total.'}
                    </p>
                  )}
                  {txType === 'dividend' && d && (() => {
                    const shares = d.ticker ? sharesHeldOn(p, d.ticker, d.date) : 0;
                    const gross = round((d.perShare ?? 0) * shares);
                    const rate = p.taxProfile
                      ? p.taxProfile.filerStatus === 'filer'
                        ? 0.15
                        : 0.3
                      : null;
                    return (
                      <p>
                        {shares} shares held on {d.date} · Gross {money(gross)}
                        {rate === null
                          ? ' · Set your filer status in Settings to estimate tax.'
                          : ` · Tax ${money(round(gross * rate))} · Net ${money(round(gross * (1 - rate)))}`}
                      </p>
                    );
                  })()}
                  {txType === 'split' && sp && (() => {
                    if (!sp.ticker || sp.oldShares <= 0 || sp.newShares <= 0)
                      return (
                        <p className="muted">
                          Pick a company and enter the old and new share counts to see a preview.
                        </p>
                      );
                    try {
                      const base = clone(p);
                      if (editingStockSplit) {
                        const old = (base.stockSplits ?? []).find((x) => x.id === editingStockSplit);
                        if (old) old.voided = true;
                      }
                      const before = sharesHeldBefore(base, sp.ticker, sp.date);
                      const after = (before * sp.newShares) / sp.oldShares;
                      const preview = clone(base);
                      preview.stockSplits ??= [];
                      preview.stockSplits.push(sp);
                      validate(preview);
                      const result = holdings(preview).find((x) => x.ticker === sp.ticker);
                      return (
                        <div className="mini-stat split-preview">
                          <span>Preview</span>
                          <b>
                            {before.toLocaleString()} → {after.toLocaleString()} shares on {sp.date}
                          </b>
                          <small>
                            Current: {result?.shares.toLocaleString() ?? '—'} shares · Total cost{' '}
                            {result?.cost === null ? 'unknown' : money(result?.cost ?? null)} · Average{' '}
                            {result?.average === null ? 'unknown' : money(result?.average ?? null)}
                          </small>
                        </div>
                      );
                    } catch (error) {
                      return (
                        <p className="notice error">
                          {error instanceof Error ? error.message : String(error)}
                        </p>
                      );
                    }
                  })()}
                  <div className="row tx-actions">
                    <button disabled={busy} type="submit">
                      {txType === 'sell'
                        ? 'Save sale'
                        : txType === 'dividend'
                          ? 'Save dividend'
                          : txType === 'split'
                            ? 'Save stock split'
                            : 'Save entry'}
                    </button>
                    {pickQueue && (
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => openPick(pickQueue, pickQueue.index + 1)}
                      >
                        Skip
                      </button>
                    )}
                    {correcting && (
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={voidEntry}
                      >
                        Void entry
                      </button>
                    )}
                  </div>
                </form>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!receipt}
        onOpenChange={(open) => {
          if (!open) setReceipt(null);
        }}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>Mark dividend as received</DialogTitle>
          <DialogDescription>
            Confirm that the cash arrived. Leave the amounts blank to keep PSX&apos;s
            expected figure with estimated tax, or enter what your broker / CDC
            statement shows.
          </DialogDescription>
          {receipt && (
            <form onSubmit={(e) => attempt(() => confirmReceipt(e))}>
              <div className="form-grid">
                <label>
                  Company symbol
                  <input disabled value={receipt.dividend.ticker} />
                </label>
                <label>
                  Payment date
                  <input
                    type="date"
                    required
                    max={today()}
                    value={receipt.paymentDate}
                    onChange={(e) => setReceipt({ ...receipt, paymentDate: e.target.value })}
                  />
                </label>
                <label>
                  Actual gross amount (PKR, optional)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={receipt.gross}
                    onChange={(e) => setReceipt({ ...receipt, gross: e.target.value })}
                  />
                </label>
                <label>
                  Tax withheld (PKR, optional)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={receipt.tax}
                    onChange={(e) => setReceipt({ ...receipt, tax: e.target.value })}
                  />
                </label>
              </div>
              <div className="row">
                <button disabled={busy} type="submit">
                  Mark received
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!company}
        onOpenChange={(open) => {
          if (!open) {
            setCompany(null);
            setCreatingCompany(false);
          }
        }}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>Company & SIP settings</DialogTitle>
          <DialogDescription>
            Targets are long-term portfolio weights. Confirm screening
            separately from AI analysis.
          </DialogDescription>
          {company && (
            <form onSubmit={(e) => attempt(() => saveCompany(e))}>
              <div className="form-grid">
                <label>
                  PSX symbol
                  <input
                    required
                    pattern="[A-Z0-9]{2,12}"
                    value={company.ticker}
                    readOnly={!creatingCompany}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        ticker: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
                <label>
                  Company name
                  <input
                    required
                    maxLength={150}
                    value={company.name}
                    onChange={(e) =>
                      setCompany({ ...company, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Sector
                  <select
                    required
                    value={company.sector ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        sector: e.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      Select sector
                    </option>
                    {Array.from(new Set([...SECTORS, ...sectorsInUse]))
                      .sort()
                      .map((sector) => (
                        <option key={sector} value={sector}>
                          {sector}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Target weight (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    required
                    value={company.target}
                    onChange={(e) =>
                      setCompany({ ...company, target: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Face value (Rs)
                  <input
                    type="number"
                    min="0.01"
                    max="1000"
                    step="0.01"
                    placeholder="10"
                    value={company.faceValue ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        faceValue: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                <label>
                  Screening effective date
                  <input
                    type="date"
                    max={today()}
                    value={company.screenDate}
                    onChange={(e) =>
                      setCompany({ ...company, screenDate: e.target.value })
                    }
                  />
                </label>
                <label className="check-row wide">
                  <Checkbox
                    checked={company.approved}
                    onCheckedChange={(v) =>
                      setCompany({ ...company, approved: !!v })
                    }
                  />{' '}
                  Enable new SIP purchases under the recorded Shariah screen
                </label>
                <label className="wide">
                  Research / screening note
                  <textarea
                    maxLength={2000}
                    value={company.note}
                    onChange={(e) =>
                      setCompany({ ...company, note: e.target.value })
                    }
                  />
                </label>
              </div>
              <p className="muted">
                {creatingCompany
                  ? 'The symbol is checked against PSX before this company is saved.'
                  : 'This existing symbol has already been created in your portfolio.'}{' '}
                Screens older than 183 days pause new allocations. Total targets
                must equal 100%; calculator caps new exposure at 20% per
                company.
              </p>
              <button disabled={busy}>Save company</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <TargetsEditor
        portfolio={p}
        open={targetsOpen}
        busy={busy}
        onOpenChange={setTargetsOpen}
        onSave={(next, message) => save(next, message)}
      />
      <Dialog
        open={!!quoteTicker}
        onOpenChange={(open) => {
          if (!open) setQuoteTicker('');
        }}
      >
        <DialogContent>
          <DialogTitle>{quoteTicker} price</DialogTitle>
          <DialogDescription>
            Enter a verified market price and its actual date.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              attempt(async () => {
                await save({
                  ...p,
                  quotes: {
                    ...p.quotes,
                    [quoteTicker]: {
                      price: Number(quotePrice),
                      date: quoteDate,
                      asOf: quoteDate + ' · manually entered',
                      manual: true,
                      source: 'https://dps.psx.com.pk/company/' + quoteTicker,
                      fetchedAt: new Date().toISOString(),
                    },
                  },
                });
                setQuoteTicker('');
              });
            }}
          >
            <label>
              Price per share (PKR)
              <input
                required
                type="number"
                min="0.0001"
                step="any"
                value={quotePrice}
                onChange={(e) => setQuotePrice(e.target.value)}
              />
            </label>
            <label>
              Quote date
              <input
                required
                type="date"
                max={today()}
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
              />
            </label>
            <p>
              <a
                target="_blank"
                rel="noreferrer"
                href={'https://dps.psx.com.pk/company/' + quoteTicker}
              >
                Check official PSX quote ↗
              </a>
            </p>
            <button disabled={busy}>Save manual price</button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
    <Toaster />
    </CompanyNavProvider>
  );
}
