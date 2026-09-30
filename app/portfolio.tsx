'use client';
import { useEffect, useRef, useState } from 'react';
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
import { Spinner } from '@/components/ui/spinner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  RefreshCw,
  Plus,
  X,
  Wallet,
  LogOut,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Bell,
} from 'lucide-react';
import {
  holdings,
  plan,
  money,
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
  pendingAutoDividends,
  type AppNotification,
} from '@/lib/portfolio';
import {
  addNotifications,
  announcementNotifications,
  dividendNotifications,
} from '@/lib/notifications';
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
import SettingsView from './settings-view';
import PsxMarketPulse, { type PsxMarketPulseHandle } from './psx-market-pulse';
import MonthlyPicks from './monthly-picks';
import { importFinqalabTrades, parseFinqalabReport } from './finqalab-import';
import { extractPdfText } from './research-pdf';
import { importAhlTrades, parseAhlHistory } from './ahl-import';
import { verifyPsxSymbol } from './psx-symbol';

const TAB_PATHS: Record<string, string> = {
  holdings: '/',
  reports: '/reports',
  sip: '/sip',
  history: '/history',
  'research-desk': '/research-desk',
  settings: '/settings',
  notifications: '/notifications',
};
const PATH_TABS: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
);
const COMPANY_PATH = new RegExp('^/company/([A-Za-z0-9]{2,12})/?$');
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
const blankTrade = (
  ticker = 'MEBL',
  kind: 'buy' | 'sell' = 'buy',
  price: number | null = null,
): Trade => ({
  id: crypto.randomUUID(),
  ticker,
  kind,
  date: today(),
  shares: 1,
  price,
  fees: 0,
  month: kind === 'buy' ? today().slice(0, 7) : '',
  note: '',
});
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
  oldShares: 1,
  newShares: 2,
  note: '',
});
function parseCdcAmount(v: unknown): number {
  return typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
}
function parseCdcPaymentDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return dateOK(iso) ? iso : null;
}
/** A CDC row is the real paid amount, so it voids the PSX-announced estimate for the same payout (mutates `existing`). */
function voidSupersededAuto(existing: Dividend[], imported: Dividend[]) {
  const voided: Dividend[] = [];
  const shift = (date: string, days: number) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  for (const row of imported) {
    const match = existing.find(
      (d) =>
        d.source === 'auto' &&
        !d.voided &&
        d.ticker === row.ticker &&
        row.date >= shift(d.date, -7) &&
        row.date <= shift(d.date, 60),
    );
    if (match) {
      match.voided = true;
      voided.push(match);
    }
  }
  return voided;
}
type CdcImportSummary = {
  dividends: Dividend[];
  imported: number;
  skippedNotPaid: number;
  skippedDuplicate: number;
  skippedUnknownTicker: number;
  skippedInvalid: number;
};
function importCdcDividends(
  raw: unknown,
  companies: Company[],
  existing: Dividend[],
): CdcImportSummary {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown } | null)?.data)
      ? (raw as { data: unknown[] }).data
      : [];
  const tickers = new Set(companies.map((c) => c.ticker));
  const seenIds = new Set(
    existing.filter((d) => !d.voided && d.externalId).map((d) => d.externalId),
  );
  const summary: CdcImportSummary = {
    dividends: [],
    imported: 0,
    skippedNotPaid: 0,
    skippedDuplicate: 0,
    skippedUnknownTicker: 0,
    skippedInvalid: 0,
  };
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (
      typeof r.dividendStatus !== 'string' ||
      r.dividendStatus.toUpperCase() !== 'PAID'
    ) {
      summary.skippedNotPaid++;
      continue;
    }
    const eventId = typeof r.eventId === 'string' ? r.eventId : undefined;
    if (eventId && seenIds.has(eventId)) {
      summary.skippedDuplicate++;
      continue;
    }
    const ticker =
      typeof r.securitySymbol === 'string'
        ? r.securitySymbol.toUpperCase()
        : '';
    if (!tickers.has(ticker)) {
      summary.skippedUnknownTicker++;
      continue;
    }
    const date =
      typeof r.paymentDate === 'string'
        ? parseCdcPaymentDate(r.paymentDate)
        : null;
    const gross = parseCdcAmount(r.grossDividendAmount);
    const net = parseCdcAmount(r.netDividendAmount);
    if (
      !date ||
      !Number.isFinite(gross) ||
      gross < 0 ||
      !Number.isFinite(net) ||
      net < 0 ||
      net > gross
    ) {
      summary.skippedInvalid++;
      continue;
    }
    summary.dividends.push({
      id: crypto.randomUUID(),
      ticker,
      date,
      source: 'import',
      grossAmount: round(gross),
      netAmount: round(net),
      externalId: eventId,
      financialYear:
        typeof r.financialYear === 'string' ? r.financialYear : undefined,
      note: '',
    });
    if (eventId) seenIds.add(eventId);
    summary.imported++;
  }
  return summary;
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
  const initialPathname = usePathname();
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
  const [p, setP] = useState<Portfolio | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [fees, setFees] = useState(0),
    [allowOld] = useState(false);
  const [trade, setTrade] = useState<Trade | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [stockSplit, setStockSplit] = useState<StockSplit | null>(null),
    [editingStockSplit, setEditingStockSplit] = useState<string | null>(null),
    [dividend, setDividend] = useState<Dividend | null>(null),
    [editingDividend, setEditingDividend] = useState<string | null>(null),
    [company, setCompany] = useState<Company | null>(null),
    [creatingCompany, setCreatingCompany] = useState(false),
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
    [showSoldOut, setShowSoldOut] = useState(false);
  function notify(s: string, error = false) {
    setMessage(s);
    setFailed(error);
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
  /** Books cash dividends PSX announced for held companies and posts payout news, in one revisioned save. */
  async function recordAutoDividends(
    loaded: Portfolio,
    loadedRevision: number,
    announcements: PayoutAnnouncement[],
  ) {
    let pending: Dividend[], news: AppNotification[];
    const now = new Date().toISOString();
    try {
      pending = pendingAutoDividends(loaded, announcements);
      news = [
        ...dividendNotifications(pending, now),
        ...announcementNotifications(loaded, announcements, today(), now),
      ];
    } catch {
      return;
    }
    if (!news.length) return;
    const next = clone(loaded);
    if (pending.length)
      next.dividends = [...(next.dividends ?? []), ...pending];
    addNotifications(next, news);
    try {
      validate(next);
      const r = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: next, revision: loadedRevision }),
      });
      const saved = (await r.json()) as ApiResponse;
      if (!r.ok) throw Error(saved.error);
      setP(next);
      setRevision(saved.revision);
      if (pending.length)
        notify(
          `Recorded ${pending.length} dividend${pending.length === 1 ? '' : 's'} from PSX announcements: ${pending.map((d) => d.ticker).join(', ')}.`,
        );
    } catch (e) {
      notify('Could not record PSX dividends: ' + String(e), true);
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
          <Wallet size={26} />
          <span>PSX / PERSONAL INVESTING</span>
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
    const replaced = voidSupersededAuto(
      next.dividends ?? [],
      result.dividends,
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
    missing = held.filter((h) => !h.quote),
    unknown = held.filter((h) => h.cost === null),
    value = round(held.reduce((a, h) => a + (h.value ?? 0), 0)),
    cost = unknown.length
      ? null
      : round(held.reduce((a, h) => a + (h.cost ?? 0), 0)),
    gain = cost === null || missing.length ? null : round(value - cost);
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
    rowsFiltered = sectorFilter
      ? rowsBase.filter((h) => h.sector === sectorFilter)
      : rowsBase,
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
    });
  const companySummary = (ticker: string) => {
    const h = hs.find((x) => x.ticker === ticker);
    const div = taxedDividends.filter((d) => d.ticker === ticker);
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
  function correctTrade(t: Trade) {
    setEditing(t.id);
    setTrade({ ...t });
  }
  function correctDividend(d: Dividend) {
    setEditingDividend(d.id);
    setDividend(
      d.source === 'auto'
        ? { ...d, source: 'manual', externalId: undefined }
        : { ...d },
    );
  }
  function correctStockSplit(entry: StockSplit) {
    setEditingStockSplit(entry.id);
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
      // A stale cached quote must not replace one the ledger already holds.
      const fresh = Object.fromEntries(
        Object.entries(d.quotes).filter(
          ([ticker]) => !(d.stale?.[ticker] && p!.quotes[ticker]),
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
    const next = clone(p!);
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
        : 'Transaction saved as a new line item. Holdings and average cost updated.',
    );
    setTrade(null);
    setEditing(null);
    if (tab !== 'company') setTab('history');
  }
  async function recordStockSplit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!stockSplit) return;
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
    setStockSplit(null);
    setEditingStockSplit(null);
    if (tab !== 'company') setTab('history');
  }
  async function recordDividend(e: React.FormEvent) {
    e.preventDefault();
    if (!dividend) return;
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
    setDividend(null);
    setEditingDividend(null);
    if (tab !== 'company') setTab('history');
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
      <header>
        <button
          type="button"
          data-slot="brand"
          className="brand"
          onClick={() => setTab('holdings')}
        >
          <Wallet size={29} />
          <span>PSX / PERSONAL INVESTING</span>
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
            aria-label="Record a purchase"
            onClick={() => {
              setEditing(null);
              setTrade(blankTrade(companyTicker || 'MEBL'));
            }}
          >
            <Plus size={18} />
            <span className="hdr-label">Record a purchase</span>
          </button>
          <Popover>
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
                  onClick={() => setTab('notifications')}
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
      </header>
      {!chromeless && (
        <section className="heading">
          <div>
            <p className="eyebrow">YOUR LONG-TERM PICTURE</p>
            <h1>Portfolio & SIP desk</h1>
            <p>
              A clear record of what you own. A considered plan for what comes
              next.
            </p>
          </div>
        </section>
      )}
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
            onClick={() => setMessage('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        {!chromeless && (
          <TabsList>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="history">Purchase log</TabsTrigger>
            <TabsTrigger value="sip">Monthly Picks</TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="research-desk">Research desk</TabsTrigger>
            )}
          </TabsList>
        )}
        <TabsContent value="holdings">
          <PsxMarketPulse ref={pulseRef} onOpenShortlist={() => setTab('sip')} />
          <PortfolioValueCard
            p={p}
            value={value}
            cost={cost}
            gain={gain}
            heldCount={held.length}
            missingCount={missing.length}
            unknownCount={unknown.length}
            newBuys={newBuys}
          />
          <div className="section-top">
            <div>
              <h2>Your companies</h2>
              <p>
                {held.length} {held.length === 1 ? 'holding' : 'holdings'}
                {sectorFilter ? ` · filtered to ${sectorFilter}` : ''}
                {showSoldOut && soldOut.length
                  ? ` · ${soldOut.length} sold out shown`
                  : ''}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
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
              <Plus size={16} /> Add company
            </button>
          </div>
          <div className="holdings-toolbar">
            <label className="holdings-toolbar-filter">
              Sector
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
              >
                <option value="">All sectors</option>
                {sectorsInUse.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </label>
            {soldOut.length > 0 && (
              <label className="check-row">
                <Checkbox
                  checked={showSoldOut}
                  onCheckedChange={(v) => setShowSoldOut(!!v)}
                />{' '}
                Show companies fully sold ({soldOut.length})
              </label>
            )}
          </div>
          <section className="panel table-panel">
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
                      <small>
                        {h.name}
                        {h.sector ? ` · ${h.sector}` : ''}
                      </small>
                      {h.target > 0 && (
                        <span className="tag">SIP shortlist</span>
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
                      {h.value === null ? '—' : money(h.value)}
                    </TableCell>
                    <TableCell
                      style={{
                        color:
                          h.gain === null
                            ? 'inherit'
                            : h.gain >= 0
                              ? '#22e0a0'
                              : '#ff5d6c',
                      }}
                    >
                      {h.gain === null ? '—' : money(h.gain)}
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
                              onClick={() => {
                                setEditing(null);
                                setTrade(
                                  blankTrade(
                                    h.ticker,
                                    'sell',
                                    h.quote?.price ?? null,
                                  ),
                                );
                              }}
                            >
                              Sell
                            </DropdownMenuItem>
                          )}
                          {h.shares > 0 && (
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingDividend(null);
                                setDividend(blankDividend(h.ticker));
                              }}
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
          <div className="section-top">
            <div>
              <h2>Purchase log</h2>
              <p>
                Every purchase, sale, dividend and split in one dated timeline.
                Open a company for its own page.
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setTrade(blankTrade(p.companies[0]?.ticker ?? 'MEBL'));
              }}
            >
              <Plus size={16} /> Add purchase
            </button>
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
              onAddPurchase={() => {
                setEditing(null);
                setTrade(blankTrade(companyTicker));
              }}
              onSell={() => {
                setEditing(null);
                setTrade(
                  blankTrade(
                    companyTicker,
                    'sell',
                    hs.find((h) => h.ticker === companyTicker)?.quote?.price ?? null,
                  ),
                );
              }}
              onDividend={() => {
                setEditingDividend(null);
                setDividend(blankDividend(companyTicker));
              }}
              onSplit={() => {
                setEditingStockSplit(null);
                setStockSplit(blankStockSplit(companyTicker));
              }}
              onEdit={() => {
                const c = p.companies.find((x) => x.ticker === companyTicker);
                if (!c) return;
                setCreatingCompany(false);
                setCompany({ ...c });
              }}
              onCorrectTrade={correctTrade}
              onCorrectDividend={correctDividend}
              onCorrectSplit={correctStockSplit}
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
        <p>
          Plans are estimates. Actual execution prices, fees, taxes and
          corporate actions may differ. No orders are placed by this dashboard.
        </p>
      </footer>
      <Dialog
        open={!!trade}
        onOpenChange={(open) => {
          if (!open) setTrade(null);
        }}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>
            {editing
              ? 'Correct transaction'
              : trade?.kind === 'sell'
                ? 'Record a sale'
                : 'Record a purchase'}
          </DialogTitle>
          <DialogDescription>
            {trade?.kind === 'opening'
              ? 'Enter the original average purchase cost if known. The statement date remains the opening snapshot date.'
              : 'Record the shares and actual price from your broker confirmation.'}
          </DialogDescription>
          {trade && (
            <form onSubmit={(e) => attempt(() => record(e))}>
              {!editing && trade.kind !== 'opening' && (
                <div className="row" style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className={
                      trade.kind === 'buy' ? 'compact' : 'secondary compact'
                    }
                    onClick={() =>
                      setTrade({
                        ...trade,
                        kind: 'buy',
                        month: today().slice(0, 7),
                      })
                    }
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className={
                      trade.kind === 'sell' ? 'compact' : 'secondary compact'
                    }
                    onClick={() =>
                      setTrade({
                        ...trade,
                        kind: 'sell',
                        month: '',
                        price:
                          trade.price ?? p.quotes[trade.ticker]?.price ?? null,
                      })
                    }
                  >
                    Sell
                  </button>
                </div>
              )}
              <div className="form-grid">
                <label>
                  Company symbol
                  <input
                    list="symbols"
                    required
                    value={trade.ticker}
                    onChange={(e) =>
                      setTrade({
                        ...trade,
                        ticker: e.target.value.toUpperCase(),
                      })
                    }
                  />
                  <datalist id="symbols">
                    {p.companies.map((c) => (
                      <option key={c.ticker} value={c.ticker}>
                        {c.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label>
                  {trade.kind === 'opening'
                    ? 'Opening snapshot date'
                    : 'Trade date'}
                  <input
                    type="date"
                    max={today()}
                    required
                    value={trade.date}
                    onChange={(e) =>
                      setTrade({ ...trade, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Number of shares
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={trade.shares}
                    onChange={(e) =>
                      setTrade({ ...trade, shares: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {trade.kind === 'opening'
                    ? 'Average cost per share (optional)'
                    : 'Price per share (PKR)'}
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    required={trade.kind !== 'opening'}
                    value={trade.price ?? ''}
                    onChange={(e) =>
                      setTrade({
                        ...trade,
                        price:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Fees (PKR)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={trade.fees}
                    onChange={(e) =>
                      setTrade({ ...trade, fees: Number(e.target.value) })
                    }
                  />
                </label>
                {trade.kind === 'buy' && (
                  <label>
                    SIP month (optional)
                    <input
                      type="month"
                      value={trade.month}
                      onChange={(e) =>
                        setTrade({ ...trade, month: e.target.value })
                      }
                    />
                  </label>
                )}
                <label className="wide">
                  Note
                  <textarea
                    maxLength={2000}
                    value={trade.note}
                    onChange={(e) =>
                      setTrade({ ...trade, note: e.target.value })
                    }
                  />
                </label>
              </div>
              <p>
                {trade.price === null
                  ? 'Cost remains unknown.'
                  : `Cash ${trade.kind === 'sell' ? 'received' : 'invested'}: ${money(trade.shares * trade.price + (trade.kind === 'sell' ? -trade.fees : trade.fees))}`}
              </p>
              <div className="row">
                <button disabled={busy} type="submit">
                  Save {trade.kind === 'sell' ? 'sale' : 'entry'}
                </button>
                {editing && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Void this entry? Its audit record will remain.',
                        )
                      )
                        return;
                      attempt(async () => {
                        const next = clone(p);
                        next.trades.find((t) => t.id === editing)!.voided =
                          true;
                        await save(next, 'Entry voided.');
                        setTrade(null);
                      });
                    }}
                  >
                    Void entry
                  </button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!stockSplit}
        onOpenChange={(open) => {
          if (!open) {
            setStockSplit(null);
            setEditingStockSplit(null);
          }
        }}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>
            {editingStockSplit ? 'Correct stock split' : 'Record stock split'}
          </DialogTitle>
          <DialogDescription>
            A split changes the number of shares held before its effective date.
            Total purchase cost stays unchanged.
          </DialogDescription>
          {stockSplit && (
            <form onSubmit={(e) => attempt(() => recordStockSplit(e))}>
              <div className="form-grid">
                <label>
                  Company symbol
                  <input required disabled value={stockSplit.ticker} />
                </label>
                <label>
                  Effective date
                  <input
                    type="date"
                    max={today()}
                    required
                    value={stockSplit.date}
                    onChange={(e) =>
                      setStockSplit({ ...stockSplit, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Old shares
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={stockSplit.oldShares}
                    onChange={(e) =>
                      setStockSplit({
                        ...stockSplit,
                        oldShares: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  New shares
                  <input
                    type="number"
                    min={stockSplit.oldShares + 1}
                    step="1"
                    required
                    value={stockSplit.newShares}
                    onChange={(e) =>
                      setStockSplit({
                        ...stockSplit,
                        newShares: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="wide">
                  Note
                  <textarea
                    maxLength={2000}
                    placeholder="For example: Face value changed from PKR 10 to PKR 2."
                    value={stockSplit.note}
                    onChange={(e) =>
                      setStockSplit({ ...stockSplit, note: e.target.value })
                    }
                  />
                </label>
              </div>
              {(() => {
                try {
                  const base = clone(p);
                  if (editingStockSplit) {
                    const old = (base.stockSplits ?? []).find(
                      (entry) => entry.id === editingStockSplit,
                    );
                    if (old) old.voided = true;
                  }
                  const before = sharesHeldBefore(
                    base,
                    stockSplit.ticker,
                    stockSplit.date,
                  );
                  const after =
                    (before * stockSplit.newShares) / stockSplit.oldShares;
                  const preview = clone(base);
                  preview.stockSplits ??= [];
                  preview.stockSplits.push(stockSplit);
                  validate(preview);
                  const result = holdings(preview).find(
                    (entry) => entry.ticker === stockSplit.ticker,
                  );
                  return (
                    <div className="mini-stat split-preview">
                      <span>Preview</span>
                      <b>
                        {before.toLocaleString()} → {after.toLocaleString()} shares
                        on {stockSplit.date}
                      </b>
                      <small>
                        Current: {result?.shares.toLocaleString() ?? '—'} shares ·
                        Total cost {result?.cost === null ? 'unknown' : money(result?.cost ?? null)} ·
                        Average {result?.average === null ? 'unknown' : money(result?.average ?? null)}
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
              <div className="row">
                <button disabled={busy} type="submit">
                  Save stock split
                </button>
                {editingStockSplit && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Void this stock split? Its audit record will remain.',
                        )
                      )
                        return;
                      attempt(async () => {
                        const next = clone(p);
                        next.stockSplits!.find(
                          (entry) => entry.id === editingStockSplit,
                        )!.voided = true;
                        await save(next, 'Stock split voided.');
                        setStockSplit(null);
                        setEditingStockSplit(null);
                      });
                    }}
                  >
                    Void entry
                  </button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!dividend}
        onOpenChange={(open) => {
          if (!open) setDividend(null);
        }}
      >
        <DialogContent className="form-dialog">
          <DialogTitle>
            {editingDividend ? 'Correct dividend' : 'Record a dividend'}
          </DialogTitle>
          <DialogDescription>
            Enter the per-share amount from your dividend notice. The gross
            amount is computed from the shares you held on the payment date.
          </DialogDescription>
          {dividend && (
            <form onSubmit={(e) => attempt(() => recordDividend(e))}>
              <div className="form-grid">
                <label>
                  Company symbol
                  <input required disabled value={dividend.ticker} />
                </label>
                <label>
                  Payment date
                  <input
                    type="date"
                    max={today()}
                    required
                    value={dividend.date}
                    onChange={(e) =>
                      setDividend({ ...dividend, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Dividend per share (PKR)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={dividend.perShare ?? 0}
                    onChange={(e) =>
                      setDividend({
                        ...dividend,
                        perShare: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="wide">
                  Note
                  <textarea
                    maxLength={2000}
                    value={dividend.note}
                    onChange={(e) =>
                      setDividend({ ...dividend, note: e.target.value })
                    }
                  />
                </label>
              </div>
              {(() => {
                const shares = sharesHeldOn(p, dividend.ticker, dividend.date);
                const gross = round((dividend.perShare ?? 0) * shares);
                const rate = p.taxProfile
                  ? p.taxProfile.filerStatus === 'filer'
                    ? 0.15
                    : 0.3
                  : null;
                return (
                  <p>
                    {shares} shares held on {dividend.date} · Gross{' '}
                    {money(gross)}
                    {rate === null
                      ? ' · Set your filer status in Settings to estimate tax.'
                      : ` · Tax ${money(round(gross * rate))} · Net ${money(round(gross * (1 - rate)))}`}
                  </p>
                );
              })()}
              <div className="row">
                <button disabled={busy} type="submit">
                  Save dividend
                </button>
                {editingDividend && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Void this dividend record? Its audit record will remain.',
                        )
                      )
                        return;
                      attempt(async () => {
                        const next = clone(p);
                        next.dividends!.find(
                          (d) => d.id === editingDividend,
                        )!.voided = true;
                        await save(next, 'Dividend record voided.');
                        setDividend(null);
                      });
                    }}
                  >
                    Void entry
                  </button>
                )}
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
    </CompanyNavProvider>
  );
}
