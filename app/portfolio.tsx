'use client';
import { useConfirm } from '@/components/confirm-dialog';
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
  Plus,
  Briefcase,
  Upload,
  Wallet,
  LogOut,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Bell,
  BarChart3,
  ScrollText,
  FlaskConical,
  Microscope,
  LockKeyhole,
} from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import {
  holdings,
  DISPLAY_PARTS,
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
  renameTicker,
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
import { addNotifications, dividendNotifications } from '@/lib/notifications';
import { syncAutoDividends } from '@/lib/dividend-sync';
import type { PayoutAnnouncement } from '@/lib/psx-payouts';
import PortfolioReports from './portfolio-reports';
import AssetReports, { AllReports } from './asset-reports';
import { reportMode } from '@/lib/asset-reports';
import PortfolioValueCard from './portfolio-value-card';
import AccountOverview from './account-overview';
import GoldSilverSection, { type OwnedMetal } from './gold-silver';
import SavingsPlansSection, { type OwnedPlan } from './savings-plans';
import { useMetalRates } from './use-metal-rates';
import MutualFundsSection, { type OwnedFund } from './mutual-funds';
import { useFundCatalog, usePlanNavs, useTrackFunds } from './use-fund-data';
import CollapsiblePanel from './collapsible-panel';
import { AddAssetMenu, StartTiles, type AssetPick } from './add-asset-menu';
import CompanyDetail from './company-detail';
import LedgerTimeline, {
  buildAssetEntries,
  buildEntries,
} from './ledger-timeline';
import { CompanyNavProvider } from './ticker-link';
import ResearchDesk from './research-desk';
import AiLab from './ai-lab';
import { SignIn, LoadError } from './sign-in';
import { UserAvatar } from './user-avatar';
import NotificationsView from './notifications-view';
import TargetsEditor from './targets-editor';
import SettingsView from './settings-view';
import { AhlImportDialog } from './ahl-import-dialog';
import { DividendSyncView } from './dividend-sync-view';
import {
  parseAhlLedgerText,
  type AhlLedgerStatement,
} from '@/lib/ahl-ledger-pdf';
import PsxMarketPulse, { type PsxMarketPulseHandle } from './psx-market-pulse';
import { MAX_WATCH_TICKERS, watchTickers } from '@/lib/market-watch';
import MonthlyPicks from './monthly-picks';
import { parseFinqalabReport } from './finqalab-import';
import { FinqalabImportDialog } from './finqalab-import-dialog';
import { BrokerImportDialog } from './broker-import-dialog';
import { detectPsxConfirmation, parsePsxConfirmation } from '@/lib/psx-confirmation';
import {
  validateBrokerStatement,
  type BrokerStatement,
  type BrokerFormat,
} from '@/lib/broker-import';
import {
  readBrokerTable,
  parseSavedFormat,
  formatFromReviewed,
  redactBrokerText,
  type BrokerTable,
} from '@/lib/broker-file';
import { IpoImportDialog } from './ipo-import-dialog';
import { parseIpoList, type IpoAllotment } from '@/lib/ipo-list-import';
import {
  detectJsonImport,
  detectPdfImport,
  summarizeImports,
  IMPORT_LABEL,
  UNSUPPORTED_FILE,
  type ImportKind,
} from '@/lib/import-detect';
import type { FinqalabTrade } from './finqalab-import';
import { extractPdfText } from './research-pdf';
import { importAhlTrades, parseAhlHistory } from './ahl-import';
import { importCdcDividends } from '@/lib/cdc-import';
import type { PortfolioResponse } from '@/lib/api-types';
import {
  ConflictError,
  VaultLockedError,
  type VaultSession,
} from '@/lib/vault-client';
import {
  loadPortfolioView,
  loadAccountView,
  savePortfolioView,
} from '@/lib/portfolio-view';
import { parseBackup, type BackupPackage } from '@/lib/vault-backup';
import { EncryptedRestoreDialog, VaultSecurity } from './vault-security';
import VaultGate from './vault-gate';
import { refreshImportQuotes } from '@/lib/import-refresh';
import PortfolioWorkspace, {
  type WorkspaceControls,
} from './portfolio-workspace';
import {
  accountFromPortfolio,
  dashboardPortfolio,
  ALL_PORTFOLIOS,
  importMatches,
} from '@/lib/portfolio-account';
import { webPublicData } from './vault-transport';
import { useCompanyLookup, type LookupView } from './use-company-lookup';
import { canSaveCompany } from '@/lib/company-lookup-client';
import {
  followQuoteJob,
  isPending,
  isProblem,
  jobMessage,
} from '@/lib/quote-refresh-client';
import { QUOTE_MESSAGES } from '@/lib/quote-jobs';
import type { QuotesResponse } from '@/lib/api-types';
import { readJson } from '@/lib/safe-json';
import { eventsForSave, importSourceOf } from '@/lib/analytics-diff';
import { flushAnalytics, track } from './analytics';

const TAB_PATHS: Record<string, string> = {
  holdings: '/',
  reports: '/reports',
  sip: '/sip',
  history: '/activity',
  'research-desk': '/research-desk',
  'ai-lab': '/ai-lab',
  settings: '/settings',
  notifications: '/notifications',
};
const PATH_TABS: Record<string, string> = Object.fromEntries([
  ...Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
  ['/history', 'history'],
]);
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
  return (tab === 'research-desk' || tab === 'ai-lab') && !isAdmin
    ? 'holdings'
    : tab;
}
function tabFromPathname(pathname: string): string {
  return companyFromPathname(pathname)
    ? 'company'
    : (PATH_TABS[pathname] ?? 'holdings');
}
type ApiResponse = {
  error?: string;
  portfolio: Portfolio;
  revision: number;
  details?: { ticker: string; name: string; sector: string }[];
  pendingCompanies?: string[];
  faceValues?: PortfolioResponse['faceValues'];
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
const SHORTLISTED = '__shortlisted';
/** Add Company may save only once the directory answered for exactly this symbol. */
const lookupReady = (lookup: LookupView, ticker: string) =>
  lookup.ticker === ticker.trim().toUpperCase() &&
  canSaveCompany({ state: lookup.status, company: lookup.company });
/** Asks for a price for a company that has none yet; the scheduled scraper does the fetch. */
async function queueQuoteRefresh(tickers: string[]) {
  try {
    await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    });
  } catch {
    /* the scheduled scraper prices held companies anyway */
  }
}
/** Status line under the symbol field while the company directory is consulted. */
function CompanyLookupNote({
  lookup,
  ticker,
}: {
  lookup: LookupView & { retry: () => void };
  ticker: string;
}) {
  if (!ticker.trim()) return null;
  const current = lookup.ticker === ticker.trim().toUpperCase();
  if (!current || lookup.status === 'idle')
    return /^[A-Z0-9]{2,12}$/.test(ticker.trim().toUpperCase()) ? (
      <p className="muted" role="status">
        Checking company details…
      </p>
    ) : (
      <p className="muted">Enter a PSX symbol (2-12 letters or digits).</p>
    );
  if (lookup.status === 'loading')
    return (
      <p className="muted" role="status">
        Checking company details…
      </p>
    );
  if (lookup.status === 'pending')
    return (
      <p className="muted" role="status">
        {lookup.message ?? 'Looking up this company…'}
      </p>
    );
  if (lookup.status === 'resolved') return null;
  return (
    <p className="notice error" role="alert">
      {lookup.message ?? 'Company details could not be found.'}{' '}
      <button
        type="button"
        className="secondary compact"
        onClick={lookup.retry}
      >
        Try again
      </button>
    </p>
  );
}
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
        placeholder={
          allowNew ? 'Search or type a PSX symbol' : 'Search your companies'
        }
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
type VaultContext = { session: VaultSession; lock: () => void };
type DashboardProps = {
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'super_admin' | 'user';
};
/**
 * Signed in is not enough: the dashboard only mounts once the vault is unlocked. Locking (or signing out) unmounts
 * it, which drops every decrypted value held in its state.
 */
export default function Dashboard(props: DashboardProps) {
  if (!props.email) return <DashboardContent {...props} vault={null} />;
  return (
    <VaultGate email={props.email}>
      {(session, lock) => (
        <PortfolioWorkspace
          session={session}
          lock={lock}
          canLock={props.role === 'super_admin'}
        >
          {(workspace) => (
            <DashboardContent
              {...props}
              vault={{ session, lock }}
              workspace={workspace}
            />
          )}
        </PortfolioWorkspace>
      )}
    </VaultGate>
  );
}
function ImportRequestRunner({
  request,
  busy,
  onRequest,
}: {
  request: WorkspaceControls['importRequest'];
  busy: boolean;
  onRequest: (request: NonNullable<WorkspaceControls['importRequest']>) => void;
}) {
  const processed = useRef<string | null>(null);
  const handle = useEffectEvent(onRequest);
  useEffect(() => {
    if (!busy && request && processed.current !== request.token) {
      processed.current = request.token;
      handle(request);
    }
  }, [busy, request]);
  return null;
}

function DashboardContent({
  email,
  name,
  picture,
  role,
  vault,
  workspace,
}: DashboardProps & {
  vault: VaultContext | null;
  workspace?: WorkspaceControls;
}) {
  const isAdmin = role === 'super_admin';
  const target = workspace?.target;
  const isAll = !!workspace?.isAll;
  const locked = !!workspace?.locked;
  const [namedAction, setNamedAction] = useState(false);
  const [txDestination, setTxDestination] = useState('');
  const [importRefreshError, setImportRefreshError] = useState('');
  const importHash = useRef<string | undefined>(undefined);
  const importActive = useRef(false);
  const mounted = useRef(true);
  const [readingImport, setReadingImport] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pulseRef = useRef<PsxMarketPulseHandle>(null);
  const emptyImportRef = useRef<HTMLInputElement>(null);
  // From 1100px the market pulse sits beside the value card's chart; below it stays under the table.
  const widePulse = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia('(min-width: 1100px)').matches,
    () => null,
  );
  const initialPathname = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [settingsEntry, setSettingsEntry] = useState({
    n: 0,
    section:
      typeof window !== 'undefined' && window.location.hash
        ? window.location.hash.slice(1)
        : 'account',
  });
  const [tab, setTabState] = useState(() =>
    allowTab(
      tabFromPathname(
        typeof window !== 'undefined'
          ? window.location.pathname
          : initialPathname,
      ),
      isAdmin,
    ),
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
      setTabState(allowTab(tabFromPathname(window.location.pathname), isAdmin));
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
    [ahlStatement, setAhlStatement] = useState<{
      statement: AhlLedgerStatement;
      fileName: string;
    } | null>(null),
    [finqalabReview, setFinqalabReview] = useState<{
      rows: FinqalabTrade[];
      fileName: string;
    } | null>(null),
    [brokerReview, setBrokerReview] = useState<{
      statement: BrokerStatement;
      fileName: string;
      format: BrokerFormat | null;
      hash: string;
      method: 'ai' | 'saved' | 'local';
    } | null>(null),
    [ipoReview, setIpoReview] = useState<{
      items: IpoAllotment[];
      fileName: string;
    } | null>(null),
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
    } | null>(null),
    [pendingCompanies, setPendingCompanies] = useState<string[]>([]),
    [encryptedRestore, setEncryptedRestore] = useState<BackupPackage | null>(
      null,
    );
  // Add Company: the ticker is the only typed identity field; name and sector come from the shared directory.
  const txNewTicker =
    !p ||
    !trade ||
    editing ||
    editingDividend ||
    editingStockSplit ||
    txType === 'sell' ||
    txType === 'dividend' ||
    txType === 'split' ||
    p.companies.some((c) => c.ticker === trade.ticker)
      ? ''
      : trade.ticker;
  const txLookup = useCompanyLookup(txNewTicker);
  const companyLookup = useCompanyLookup(
    creatingCompany && company ? company.ticker : '',
  );
  useEffect(() => {
    if (!creatingCompany) return;
    const name = companyLookup.company?.name ?? '';
    const sector = companyLookup.company?.sector ?? '';
    setCompany((c) =>
      c && (c.name !== name || c.sector !== sector)
        ? { ...c, name, sector }
        : c,
    );
  }, [creatingCompany, companyLookup.company]);
  useEffect(() => {
    const name = txLookup.company?.name ?? '';
    const sector = txLookup.company?.sector ?? '';
    setTxCompany((c) =>
      c.name === name && c.sector === sector ? c : { name, sector },
    );
  }, [txLookup.company]);
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
  const quoteAlive = useRef(true);
  const quoteRunning = useRef(false);
  useEffect(() => {
    quoteAlive.current = true;
    return () => {
      quoteAlive.current = false;
    };
  }, []);
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
  /** Applies refreshed prices locally. They are already in the shared cache the next load merges in, so no save is needed. */
  function applyQuotes(
    quotes: Portfolio['quotes'],
    stale: Record<string, string> = {},
  ) {
    setP((current) => {
      if (current?.[DISPLAY_PARTS]) {
        const parts = current[DISPLAY_PARTS]!.map((part) => ({
          ...part,
          portfolio: {
            ...part.portfolio,
            quotes: {
              ...part.portfolio.quotes,
              ...Object.fromEntries(
                Object.entries(quotes).filter(
                  ([ticker, q]) =>
                    part.portfolio.companies.some((c) => c.ticker === ticker) &&
                    isValidQuote(q) &&
                    quoteSupersedes(q, part.portfolio.quotes[ticker]),
                ),
              ),
            },
          },
        }));
        return dashboardPortfolio({
          kind: 'sipwise-portfolio-account',
          version: 1,
          portfolios: parts,
        });
      }
      if (!current) return current;
      const fresh = Object.fromEntries(
        Object.entries(quotes).filter(
          ([ticker, quote]) =>
            isValidQuote(quote) &&
            !(stale[ticker] && current.quotes[ticker]) &&
            quoteSupersedes(quote, current.quotes[ticker]),
        ),
      );
      return Object.keys(fresh).length
        ? { ...current, quotes: { ...current.quotes, ...fresh } }
        : current;
    });
  }
  /** POST starts (or joins) a refresh; GET with `since` (even empty) only reads its state. */
  async function quoteCall(tickers: string[], since?: string) {
    if (!tickers.length) throw Error('No companies to price.');
    const r =
      since === undefined
        ? await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers }),
          })
        : await fetch(
            `/api/quotes?tickers=${tickers.join(',')}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
          );
    const d = (await readJson(r)) as QuotesResponse & { error?: string };
    if (!r.ok) throw Error(d.error);
    return d;
  }
  /** Follows a refresh job to its end and reports it with the single user-facing message for its state. */
  async function followRefresh(tickers: string[], start: boolean) {
    const final = await followQuoteJob({
      start: start ? () => quoteCall(tickers) : undefined,
      poll: (since) => quoteCall(tickers, since ?? ''),
      cancelled: () => !quoteAlive.current,
      onPending: (d) => applyQuotes(d.quotes, d.stale),
    });
    if (!quoteAlive.current) return;
    applyQuotes(final.quotes, final.stale);
    if (isPending(final.job)) return notify(QUOTE_MESSAGES.pending);
    if (final.job) notify(jobMessage(final.job), isProblem(final.job));
  }
  async function refreshImported(tickers: string[]) {
    setImportRefreshError('');
    if (!tickers.length) return;
    try {
      notify('Import saved. Refreshing PSX prices…');
      const result = await refreshImportQuotes({
        start: () => quoteCall(tickers),
        poll: (since) => quoteCall(tickers, since ?? ''),
        cancelled: () => !quoteAlive.current,
        onPending: (d) => applyQuotes(d.quotes, d.stale),
      });
      if (quoteAlive.current) {
        applyQuotes(result.quotes, result.stale);
        notify('Import saved. PSX prices refreshed.');
      }
    } catch (e) {
      setImportRefreshError(
        e instanceof Error ? e.message : 'PSX prices could not be refreshed.',
      );
    }
  }
  async function refresh() {
    if (!p || quoteRunning.current) return;
    track('price_refresh_requested');
    quoteRunning.current = true;
    setBusy(true);
    try {
      notify(QUOTE_MESSAGES.pending);
      void pulseRef.current?.refresh();
      await followRefresh(
        p.companies.map((c) => c.ticker),
        true,
      );
    } catch (e) {
      notify(
        e instanceof Error && e.message ? e.message : QUOTE_MESSAGES.failed,
        true,
      );
    } finally {
      quoteRunning.current = false;
      setBusy(false);
    }
  }
  /** After a reload, picks up a refresh that is still queued or running instead of starting another. */
  async function resumeRefresh(tickers: string[]) {
    if (quoteRunning.current || !tickers.length) return;
    try {
      const d = await quoteCall(tickers, '');
      if (!isPending(d.job)) return;
      quoteRunning.current = true;
      notify(QUOTE_MESSAGES.pending);
      await followRefresh(tickers, false);
    } catch {
      /* nothing to resume */
    } finally {
      quoteRunning.current = false;
    }
  }
  async function load() {
    setBusy(true);
    try {
      // Decrypts locally, then overlays the shared public caches (quotes, announcements, face values).
      const d = isAll
        ? await loadAccountView(vault!.session, webPublicData, true).then(
            (out) => ({
              portfolio: dashboardPortfolio(out.account),
              revision: out.revision,
              pendingCompanies: [],
              announcements: [],
              faceValues: {},
            }),
          )
        : await loadPortfolioView(vault!.session, webPublicData, target);
      setP(d.portfolio);
      setRevision(d.revision);
      setPendingCompanies(d.pendingCompanies ?? []);
      void resumeRefresh(d.portfolio.companies.map((c) => c.ticker));
      if (!isAll && !locked && !target?.name)
        await recordAutoDividends(
          d.portfolio,
          d.revision,
          d.announcements ?? [],
          d.faceValues ?? {},
        );
    } catch (e) {
      // A lock mid-load is not an error to show: the unlock screen takes over.
      if (!(e instanceof VaultLockedError)) notify(String(e), true);
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
    faceValues: NonNullable<PortfolioResponse['faceValues']>,
  ) {
    const result = await syncAutoDividends(
      { portfolio: loaded, revision: loadedRevision },
      announcements,
      {
        save: async (next, revision) => {
          try {
            return {
              revision: await vault!.session.save(next, revision, target),
            };
          } catch (e) {
            if (e instanceof ConflictError) return { conflict: true };
            throw e;
          }
        },
        reload: async () => {
          try {
            const d = await loadPortfolioView(
              vault!.session,
              webPublicData,
              target,
            );
            return { portfolio: d.portfolio, revision: d.revision };
          } catch {
            return null;
          }
        },
      },
      { faceValues },
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
      if (isAll) {
        const changed = change(p!.notifications ?? []);
        const account = vault!.session.account;
        await vault!.session.saveAccount(
          {
            ...account,
            portfolios: account.portfolios.map((part) =>
              part.locked
                ? part
                : {
                    ...part,
                    portfolio: {
                      ...part.portfolio,
                      notifications: changed
                        .filter((n) => n.id.startsWith(part.id + '::'))
                        .map((n) => ({
                          ...n,
                          id: n.id.slice(part.id.length + 2),
                          title: n.title.replace(part.name + ' · ', ''),
                        })),
                    },
                  },
            ),
          },
          revision,
        );
        await load();
        return;
      }
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
    options: {
      createCompanies?: string[];
      target?: import('@/lib/portfolio-account').PortfolioTarget;
      /** Reload the selected view after saving a different portfolio than the one on screen. */
      reload?: boolean;
    } = {},
  ) {
    if (!mounted.current)
      throw Error('This portfolio view was closed. Reopen it before saving.');
    if (busy) throw Error('Wait for the current operation to finish.');
    if (target?.name && !importActive.current)
      throw Error('Save the import first to create this portfolio.');
    const saveTarget = options.target ?? (isAll ? undefined : target);
    if (!saveTarget || saveTarget.id === ALL_PORTFOLIOS)
      throw Error('Choose a portfolio before saving.');
    const wasImport = importActive.current;
    validate(next);
    if (importActive.current && target) {
      const matches = importMatches(
        vault!.session.account,
        target.id,
        next,
        importHash.current,
      );
      if (
        matches.length &&
        !(await confirm({
          title: 'This import appears in another portfolio',
          description: `Matching records were found in ${matches.map((p) => p.name).join(', ')}. Importing here too will count them twice in All portfolios.`,
          confirmLabel: 'Import here anyway',
        }))
      )
        throw Error('Import cancelled. Nothing was saved.');
      if (importHash.current)
        next.brokerFileHashes = [
          ...new Set([...(next.brokerFileHashes ?? []), importHash.current]),
        ];
    }
    setBusy(true);
    try {
      // Validates, fills company details from the public directory, encrypts here and stores ciphertext only.
      const d = await savePortfolioView(
        vault!.session,
        webPublicData,
        next,
        revision,
        options.createCompanies,
        saveTarget,
      );
      // Show the name and sector filled in from the company directory.
      for (const detail of d.details ?? []) {
        const company = next.companies.find((c) => c.ticker === detail.ticker);
        if (company) {
          company.name = detail.name;
          company.sector = detail.sector;
        }
      }
      if (isAll || options.reload) await load();
      else setP(next);
      setRevision(d.revision);
      setPendingCompanies(d.pendingCompanies ?? []);
      if (importActive.current) {
        importActive.current = false;
        importHash.current = undefined;
        workspace?.onSaved();
      }
      if (wasImport) void refreshImported(next.companies.map((c) => c.ticker));
      for (const e of eventsForSave(p, next, wasImport ? importSourceOf(p, next) : undefined)) track(e.event, e.props);
      notify(
        d.pendingCompanies?.length
          ? `${success} Company details for ${d.pendingCompanies.join(', ')} are still being looked up; your transactions are saved and the details will fill in on a later load.`
          : success,
      );
    } catch (e) {
      if (wasImport && !(e instanceof VaultLockedError)) track('import_failed', { source: 'broker' });
      if (e instanceof ConflictError) {
        importActive.current = false;
        importHash.current = undefined;
        setAhlStatement(null);
        setFinqalabReview(null);
        setBrokerReview(null);
        setIpoReview(null);
        await load();
      }
      if (!(e instanceof VaultLockedError))
        notify(e instanceof Error ? e.message : String(e), true);
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
    return ` Warning: ${tickers.length === 1 ? 'a sale has' : tickers.length + ' sales have'} unknown cost basis (${tickers.join(', ')}). Review the acquisition history before relying on tax figures.`;
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, opts: unknown) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context?.registerTool || !p) return;
    const abort = new AbortController();
    try {
      Promise.resolve(
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
              return {
                holdings: holdings(p),
                plan: plan(p, m, fees, allowOld),
              };
            },
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => abort.abort();
  }, [p, fees, allowOld]);
  const workspaceBusy = workspace?.onBusy;
  useEffect(() => {
    workspaceBusy?.(
      busy ||
        readingImport ||
        !!ahlStatement ||
        !!finqalabReview ||
        !!brokerReview ||
        !!ipoReview ||
        !!trade ||
        !!company ||
        !!receipt ||
        targetsOpen ||
        !!quoteTicker,
    );
  }, [
    workspaceBusy,
    busy,
    readingImport,
    ahlStatement,
    finqalabReview,
    brokerReview,
    ipoReview,
    trade,
    company,
    receipt,
    targetsOpen,
    quoteTicker,
  ]);
  const metalRates = useMetalRates(
    !!(isAll
      ? p?.[DISPLAY_PARTS]?.some((part) =>
          part.portfolio.assets?.some((a) => a.kind === 'metal'),
        )
      : p?.assets?.some((a) => a.kind === 'metal')),
  );
  const [assetAdd, setAssetAdd] = useState<{
    kind: 'metal' | 'plan' | 'fund';
    n: number;
  }>({ kind: 'metal', n: 0 });
  const fundData = useFundCatalog(
    !!(isAll
      ? p?.[DISPLAY_PARTS]?.some((part) =>
          part.portfolio.assets?.some((a) => a.kind === 'fund'),
        )
      : p?.assets?.some((a) => a.kind === 'fund')) || tab === 'holdings',
  );
  const planNavData = usePlanNavs(
    (isAll
      ? (p?.[DISPLAY_PARTS]?.flatMap((part) => part.portfolio.assets ?? []) ??
        [])
      : (p?.assets ?? [])
    ).some((a) => a.kind === 'plan' && !!a.subFund),
  );
  const planNavs = planNavData.navs;
  const tracking = useTrackFunds(
    (isAll
      ? (p?.[DISPLAY_PARTS]?.flatMap((part) => part.portfolio.assets ?? []) ??
        [])
      : (p?.assets ?? [])
    ).flatMap((a) => (a.kind === 'fund' ? [a.mufapId] : [])),
    fundData.reload,
  );
  // Monthly Picks is a general stock-picking tool: it always works on the companies and holdings of every
  // portfolio, whichever one is selected. Its saved inputs and runs live in the account's first portfolio.
  useEffect(() => {
    if (!email) return;
    track('app_opened');
  }, [email]);
  useEffect(() => {
    if (!email) return;
    const screen = companyTicker
      ? 'company'
      : tab === 'holdings'
        ? isAll
          ? 'overview'
          : 'holdings'
        : tab === 'history'
          ? 'activity'
          : tab === 'reports' || tab === 'sip' || tab === 'settings' || tab === 'notifications'
            ? tab
            : null;
    if (screen) track('screen_viewed', { screen });
  }, [email, tab, companyTicker, isAll]);
  const importOpen = ahlStatement ? 'ahl' : finqalabReview ? 'finqalab' : brokerReview ? 'broker' : ipoReview ? 'ipo' : null;
  useEffect(() => {
    if (importOpen) track('import_started', { source: importOpen });
  }, [importOpen]);
  const picksHome = workspace?.account.portfolios[0];
  const picksPortfolio = useMemo(() => {
    if (!workspace || !picksHome) return p;
    const combined = dashboardPortfolio(workspace.account, ALL_PORTFOLIOS);
    if (workspace.account.portfolios.length < 2) return p ?? combined;
    const quotes = { ...combined.quotes };
    for (const [ticker, quote] of Object.entries(p?.quotes ?? {}))
      if (!quotes[ticker] || quote.date >= quotes[ticker].date)
        quotes[ticker] = quote;
    return {
      ...combined,
      quotes,
      budgets: picksHome.portfolio.budgets,
      monthlyPicksShortlist: picksHome.portfolio.monthlyPicksShortlist,
      monthlyPicksList: picksHome.portfolio.monthlyPicksList,
      monthlyPicksRuns: picksHome.portfolio.monthlyPicksRuns,
    };
  }, [workspace, picksHome, p]);
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
  if (!p) return <LoadError message={message} busy={busy} onRetry={load} />;
  // The market pulse sends only these tickers to the server; names and saved quotes are merged back in locally.
  // The All view follows the Monthly Picks shortlist; a single portfolio follows what it holds.
  const pulseWatch = {
    mode: (isAll ? 'shortlist' : 'holdings') as 'shortlist' | 'holdings',
    tickers: isAll
      ? watchTickers(p)
      : holdings(p)
          .filter((h) => h.shares > 0)
          .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
          .map((h) => h.ticker)
          .slice(0, MAX_WATCH_TICKERS),
    names: Object.fromEntries(p.companies.map((c) => [c.ticker, c.name])),
    saved: p.quotes,
  };
  const destinationName =
    target?.name ??
    vault?.session.account?.portfolios.find((entry) => entry.id === target?.id)
      ?.name ??
    'My Portfolio';
  function restoreBackup(f: File) {
    attempt(async () => {
      // Either an encrypted package (asks for its password) or a readable ledger from an older version. Both are
      // decrypted/validated here and re-encrypted into the current vault; nothing readable is uploaded.
      try {
        const parsed = parseBackup(await f.text());
        if (parsed.type === 'encrypted')
          return setEncryptedRestore(parsed.backup);
        if (parsed.type === 'account')
          throw Error('Restore this collection from All portfolios.');
        await save(parsed.portfolio, 'Portfolio backup restored.');
      } finally {
        importActive.current = false;
      }
    });
  }
  const runCdc = async (raw: unknown) => {
    const result = importCdcDividends(raw, p.companies, p.dividends ?? []);
    if (!result.imported) {
      if (result.skippedDuplicate)
        void refreshImported(p.companies.map((c) => c.ticker));
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
    next.dividends = [...(next.dividends ?? []), ...result.dividends];
    if (
      !(await confirm({
        title: 'Review CDC import',
        description: `${result.imported} paid dividends will be added to ${destinationName}; ${superseded} PSX estimates will be replaced.`,
        confirmLabel: 'Import dividends',
      }))
    )
      return;
    await save(
      next,
      `${result.imported} dividend${result.imported === 1 ? '' : 's'} imported${superseded ? `, replacing ${superseded} PSX auto record${superseded === 1 ? '' : 's'}` : ''}. Skipped: ${result.skippedNotPaid} not paid, ${result.skippedDuplicate} duplicate, ${result.skippedUnknownTicker} unknown ticker, ${result.skippedInvalid} invalid.`,
    );
  };
  const runFinqalab = (text: string, fileName: string) => {
    // Read locally, then review: nothing is saved until the preview is confirmed.
    setFinqalabReview({ rows: parseFinqalabReport(text), fileName });
  };
  const runAhlJson = async (raw: unknown) => {
    const rows = parseAhlHistory(raw);
    const result = importAhlTrades(p, rows);
    if (!result.imported) {
      if (result.skippedDuplicate || result.skippedManualMatch)
        void refreshImported(p.companies.map((c) => c.ticker));
      notify(
        `No AHL trades imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`,
        true,
      );
      return;
    }
    const next = clone(p);
    next.companies = result.companies;
    for (const trade of next.trades) {
      if (result.voidedTradeIds.includes(trade.id)) trade.voided = true;
    }
    next.trades = [...next.trades, ...result.trades];
    if (
      !(await confirm({
        title: 'Review AHL import',
        description: `${result.imported} trades and ${result.addedCompanies} companies will be added to ${destinationName}. ${result.skippedDuplicate} duplicates will be skipped.`,
        confirmLabel: 'Import trades',
      }))
    )
      return;
    await save(
      next,
      `${result.imported} AHL trade${result.imported === 1 ? '' : 's'} imported. Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.${result.voidedTradeIds.length ? ` Reconciled ${result.voidedTradeIds.length} duplicate opening balance${result.voidedTradeIds.length === 1 ? '' : 's'}.` : ''}${result.addedCompanies ? ` Added ${result.addedCompanies} unapproved compan${result.addedCompanies === 1 ? 'y' : 'ies'}.` : ''}${unknownCostWarning(next)}`,
    );
  };
  /** One entry point for every import file: works out what it is, then opens that import's review. */
  const importFile = (f: File, expected?: ImportKind) =>
    workspace
      ? workspace.requestImport(f, expected)
      : processImportFile(f, expected);
  function processImportFile(f: File, expected?: ImportKind) {
    if (!p) return;
    attempt(async () => {
      setReadingImport(true);
      let reviewing = false;
      try {
        const bytes = await f.arrayBuffer();
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        if (!mounted.current) return;
        importHash.current = hash;
        importActive.current = true;
        if (p.brokerFileHashes?.includes(hash)) {
          notify('This statement was already imported. Refreshing PSX prices…');
          void refreshImported(p.companies.map((c) => c.ticker));
          return;
        }
        let kind: ImportKind | null;
        let pdf: { text: string; pages: number } | null = null;
        let raw: unknown;
        let table: BrokerTable | null = null;
        let unknownText = '';
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          // Read locally, then review: nothing is saved until the preview is confirmed.
          pdf = await extractPdfText(new Uint8Array(bytes));
          kind = detectPdfImport(pdf.text);
          unknownText = pdf.text;
        } else if (/\.(csv|xlsx)$/i.test(f.name)) {
          table = await readBrokerTable(f);
          kind = null;
          unknownText = table.text;
          const saved = (p.brokerFormats ?? []).find(
            (format) =>
              format.signature === table!.signature &&
              new RegExp(
                format.broker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                'i',
              ).test(`${f.name} ${table!.text.slice(0, 500)}`),
          );
          if (saved) {
            try {
              reviewing = true;
              setBrokerReview({
                statement: parseSavedFormat(table, saved),
                fileName: f.name,
                format: null,
                hash,
                method: 'saved',
              });
              return;
            } catch {
              /* A changed layout needs fresh extraction and review. */
            }
          }
        } else {
          try {
            raw = JSON.parse(await f.text());
            kind = detectJsonImport(raw);
            unknownText = JSON.stringify(raw);
          } catch {
            throw Error(UNSUPPORTED_FILE);
          }
        }
        if (!kind && pdf && !expected && detectPsxConfirmation(pdf.text)) {
          // Youngs Capital, Syed Faraz Equities and other brokers on the same PSX confirmation template.
          reviewing = true;
          setBrokerReview({
            statement: validateBrokerStatement(parsePsxConfirmation(pdf.text)),
            fileName: f.name,
            format: null,
            hash,
            method: 'local',
          });
          return;
        }
        if (!kind) {
          if (expected) throw Error(UNSUPPORTED_FILE);
          if (pdf && unknownText.trim())
            // AI reading of PDFs is paused: only recognized brokers are parsed.
            throw Error(
              'We don’t recognize this broker’s statement yet. We’re working on adding your broker to Sipwise.',
            );
          if (!unknownText.trim())
            throw Error(
              'No readable text was found. Scanned statements are not supported yet.',
            );
          const ok = await confirm({
            title: 'Read this statement with AI?',
            description:
              'Statement text will be sent to the app’s configured AI provider for extraction. It may contain personal details. Your saved portfolio stays on this device, and nothing is added until you review the result.',
            confirmLabel: 'Read statement',
          });
          if (!ok) return;
          const response = await fetch('/api/broker-import/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: redactBrokerText(unknownText) }),
            credentials: 'same-origin',
          });
          const data = (await response.json()) as {
            statement?: unknown;
            error?: string;
          };
          if (!response.ok)
            throw Error(data.error ?? 'Statement extraction failed.');
          const statement = validateBrokerStatement(data.statement);
          reviewing = true;
          setBrokerReview({
            statement,
            fileName: f.name,
            format: table ? formatFromReviewed(table, statement) : null,
            hash,
            method: 'ai',
          });
          return;
        }
        if (!isAdmin && (kind === 'cdc' || kind === 'ipo'))
          throw Error(
            'IPO and dividend imports are available to super admins only.',
          );
        if (expected && kind !== expected)
          throw Error(
            `That looks like a ${IMPORT_LABEL[kind]} file, not ${IMPORT_LABEL[expected]}. Use the matching card, or the drop box, which picks the right import itself.`,
          );
        if (kind === 'finqalab') {
          reviewing = true;
          runFinqalab(pdf!.text, f.name);
        } else if (kind === 'ahl' && pdf) {
          reviewing = true;
          setAhlStatement({
            statement: await parseAhlLedgerText(pdf.text, pdf.pages),
            fileName: f.name,
          });
        } else if (kind === 'ahl') await runAhlJson(raw);
        else if (kind === 'cdc') await runCdc(raw);
        else {
          reviewing = true;
          setIpoReview({ items: parseIpoList(raw), fileName: f.name });
        }
      } finally {
        if (!reviewing) {
          importActive.current = false;
          importHash.current = undefined;
        }
        setReadingImport(false);
      }
    });
  }
  const exportEncryptedBackup = () =>
    attempt(async () => {
      const pkg = await vault!.session.backupPackage();
      track('backup_exported');
      download(
        `sipwise-backup-${today()}.encrypted.json`,
        JSON.stringify(pkg, null, 2),
      );
      notify(
        'Encrypted backup downloaded. It opens only with your vault password or recovery key.',
      );
    });
  const exportBackup = () =>
    void confirm({
      title: 'Export a readable file?',
      description:
        'This file is NOT encrypted. Anyone who gets it can read every holding and trade in it. Choose the encrypted backup if you only need a safe copy.',
      confirmLabel: 'Export readable file',
    }).then((ok) => {
      if (ok) exportReadable();
    });
  const exportReadable = () =>
    download(
      `psx-portfolio-${today()}.json`,
      JSON.stringify(
        isAll
          ? {
              kind: 'sipwise-portfolio-account-backup',
              schemaVersion: 1,
              account: vault!.session.account,
            }
          : {
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
    {
      value,
      cost,
      gain,
      missingPrice: missing,
      unknownCost: unknown,
    } = portfolioSummary(hs);
  const overviewParts = isAll ? p[DISPLAY_PARTS] : undefined;
  const allAssets = isAll
    ? (overviewParts ?? []).flatMap((part) =>
        (part.portfolio.assets ?? []).map((asset) => ({
          asset,
          portfolioId: part.id,
          portfolioName: part.name,
        })),
      )
    : (p.assets ?? []).map((asset) => ({
        asset,
        portfolioId: undefined,
        portfolioName: undefined,
      }));
  const ownedMetals: OwnedMetal[] = allAssets.flatMap((o) =>
    o.asset.kind === 'metal' ? [{ ...o, asset: o.asset }] : [],
  );
  const ownedPlans: OwnedPlan[] = allAssets.flatMap((o) =>
    o.asset.kind === 'plan' ? [{ ...o, asset: o.asset }] : [],
  );
  const ownedFunds: OwnedFund[] = allAssets.flatMap((o) =>
    o.asset.kind === 'fund' ? [{ ...o, asset: o.asset }] : [],
  );
  const hasAssets = allAssets.length > 0;
  // Monthly Picks is stock-only, so the tab shows once any portfolio holds a stock.
  const hasStocks = workspace
    ? workspace.account.portfolios.some((part) => part.portfolio.companies.length > 0)
    : p.companies.length > 0;
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
        <DropdownMenuItem onClick={() => openCompany(h.ticker)}>
          View company
        </DropdownMenuItem>
        {h.shares > 0 && (
          <DropdownMenuItem
            onClick={() => openTx('sell', h.ticker, h.quote?.price ?? null)}
          >
            Sell
          </DropdownMenuItem>
        )}
        {h.shares > 0 && (
          <DropdownMenuItem onClick={() => openTx('dividend', h.ticker)}>
            Dividend
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            if (isAll) {
              setNamedAction(true);
              return;
            }
            if (locked) return;
            setCreatingCompany(false);
            setCompany({
              ...p.companies.find((c) => c.ticker === h.ticker)!,
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
  // A portfolio with nothing in it shows only its start screen: no tabs to open.
  const hideTabs = chromeless || (p.companies.length === 0 && !hasAssets);
  const taxedDividends = taxSummary(p).dividends;
  const ledgerEntries = (ticker: string | undefined) =>
    [
      ...buildAssetEntries(ticker ? [] : allAssets, () => setTab('holdings')),
      ...buildEntries({
        trades: p.trades.filter((t) => !ticker || t.ticker === ticker),
        dividends: (p.dividends ?? []).filter(
          (d) => !ticker || d.ticker === ticker,
        ),
        splits: (p.stockSplits ?? []).filter(
          (x) => !ticker || x.ticker === ticker,
        ),
        taxed: taxedDividends,
        onCorrectTrade: correctTrade,
        onCorrectDividend: correctDividend,
        onCorrectSplit: correctStockSplit,
        onConfirmDividend: openReceipt,
      }),
    ].sort(
      (a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key),
    );
  const companySummary = (ticker: string) => {
    const h = hs.find((x) => x.ticker === ticker);
    const div = taxedDividends.filter(
      (d) => d.ticker === ticker && d.status === 'received',
    );
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
    if (window.location.pathname !== path)
      window.history.pushState(null, '', path);
    window.scrollTo({ top: 0 });
  }
  function pickAsset(kind: AssetPick) {
    if (kind === 'stock') openTx('buy');
    else setAssetAdd((s) => ({ kind, n: s.n + 1 }));
  }
  /** Opens the one Add transaction dialog, preset to a type and (optionally) a company. */
  function openTx(type: TxType, ticker = '', price: number | null = null) {
    if (locked) {
      notify(
        'This portfolio is locked. Unlock it in Settings → Portfolios.',
        true,
      );
      return;
    }
    setTxDestination(isAll ? '' : (target?.id ?? ''));
    setEditing(null);
    setEditingDividend(null);
    setEditingStockSplit(null);
    setTxType(type);
    setTxCompany({ name: '', sector: '' });
    setTrade(
      blankTrade(
        ticker,
        type === 'sell' || type === 'opening' ? type : 'buy',
        price,
      ),
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
    const valid = picks.filter(
      (x) => x.price !== null && x.price > 0 && x.shares > 0,
    );
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
    if (isAll) {
      const owner = p![DISPLAY_PARTS]?.find((part) =>
        t.id.startsWith(part.id + '::'),
      );
      if (
        !owner ||
        workspace?.account.portfolios.find((part) => part.id === owner.id)
          ?.locked
      ) {
        notify(
          'This portfolio is locked. Unlock it in Settings → Portfolios.',
          true,
        );
        return;
      }
      const original = owner.portfolio.trades?.find(
        (row) => owner.id + '::' + row.id === t.id,
      );
      if (!original) return;
      setTxDestination(owner.id);
      t = original;
    } else if (locked) {
      notify(
        'This portfolio is locked. Unlock it in Settings → Portfolios.',
        true,
      );
      return;
    }
    if (t.kind === 'adjustment') {
      void confirm({
        title: 'Void this holding adjustment?',
        description:
          'The original adjustment stays in the audit history. Re-import the corrected statement to add a replacement.',
        confirmLabel: 'Void',
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        attempt(async () => {
          const owner = isAll
            ? p![DISPLAY_PARTS]?.find((part) =>
                part.portfolio.trades.some((row) => row === t),
              )
            : undefined;
          const next = clone(owner?.portfolio ?? p!);
          const entry = next.trades.find((x) => x.id === t.id);
          if (entry) entry.voided = true;
          await save(
            next,
            'Holding adjustment voided.',
            owner ? { target: { id: owner.id } } : {},
          );
        });
      });
      return;
    }
    setEditing(t.id);
    setTxType(t.kind);
    setTrade({ ...t });
  }
  function correctDividend(d: Dividend) {
    if (isAll) {
      const owner = p![DISPLAY_PARTS]?.find((part) =>
        d.id.startsWith(part.id + '::'),
      );
      if (
        !owner ||
        workspace?.account.portfolios.find((part) => part.id === owner.id)
          ?.locked
      ) {
        notify(
          'This portfolio is locked. Unlock it in Settings → Portfolios.',
          true,
        );
        return;
      }
      const original = owner.portfolio.dividends?.find(
        (row) => owner.id + '::' + row.id === d.id,
      );
      if (!original) return;
      setTxDestination(owner.id);
      d = original;
    } else if (locked) {
      notify(
        'This portfolio is locked. Unlock it in Settings → Portfolios.',
        true,
      );
      return;
    }
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
            paymentDateUnknown: undefined,
            receiptConfirmedAt: undefined,
            entitlement: undefined,
          }
        : { ...d },
    );
  }
  function openReceipt(d: Dividend) {
    if (isAll) {
      const owner = p![DISPLAY_PARTS]?.find((part) =>
        d.id.startsWith(part.id + '::'),
      );
      if (
        !owner ||
        workspace?.account.portfolios.find((part) => part.id === owner.id)
          ?.locked
      ) {
        notify(
          'This portfolio is locked. Unlock it in Settings → Portfolios.',
          true,
        );
        return;
      }
      const original = owner.portfolio.dividends?.find(
        (row) => owner.id + '::' + row.id === d.id,
      );
      if (!original) return;
      setTxDestination(owner.id);
      d = original;
    } else if (locked) {
      notify(
        'This portfolio is locked. Unlock it in Settings → Portfolios.',
        true,
      );
      return;
    }
    setReceipt({ dividend: d, paymentDate: today(), gross: '', tax: '' });
  }
  async function confirmReceipt(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!receipt) return;
    const next = clone(transactionPortfolio());
    const target = next.dividends?.find((d) => d.id === receipt.dividend.id);
    if (!target) return;
    const gross =
      receipt.gross.trim() === '' ? undefined : Number(receipt.gross);
    const tax = receipt.tax.trim() === '' ? undefined : Number(receipt.tax);
    if (
      (gross !== undefined && !(gross >= 0)) ||
      (tax !== undefined && !(tax >= 0))
    )
      throw Error('Enter amounts as positive numbers, or leave them blank.');
    Object.assign(
      target,
      confirmDividendReceipt(target, {
        paymentDate: receipt.paymentDate,
        grossAmount: gross,
        taxWithheld: tax,
      }),
    );
    await save(
      next,
      `${target.ticker} dividend marked as received.`,
      isAll ? { target: { id: txDestination } } : {},
    );
    setReceipt(null);
  }
  function correctStockSplit(entry: StockSplit) {
    if (isAll) {
      const owner = p![DISPLAY_PARTS]?.find((part) =>
        entry.id.startsWith(part.id + '::'),
      );
      if (
        !owner ||
        workspace?.account.portfolios.find((part) => part.id === owner.id)
          ?.locked
      ) {
        notify(
          'This portfolio is locked. Unlock it in Settings → Portfolios.',
          true,
        );
        return;
      }
      const original = owner.portfolio.stockSplits?.find(
        (row) => owner.id + '::' + row.id === entry.id,
      );
      if (!original) return;
      setTxDestination(owner.id);
      entry = original;
    } else if (locked) {
      notify(
        'This portfolio is locked. Unlock it in Settings → Portfolios.',
        true,
      );
      return;
    }
    setEditingStockSplit(entry.id);
    setTxType('split');
    setStockSplit({ ...entry });
  }
  function transactionPortfolio(): Portfolio {
    if (!isAll) return p!;
    const part = p?.[DISPLAY_PARTS]?.find(
      (entry) => entry.id === txDestination,
    );
    if (!part) throw Error('Choose a destination portfolio.');
    return part.portfolio;
  }
  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!trade) return;
    if (!trade.ticker) throw Error('Choose a company first.');
    const next = clone(transactionPortfolio());
    const isNew = !next.companies.some((c) => c.ticker === trade.ticker);
    if (isNew) {
      if (!/^[A-Z0-9]{2,12}$/.test(trade.ticker))
        throw Error('Enter a valid PSX symbol (2-12 letters or digits).');
      if (!lookupReady(txLookup, trade.ticker))
        throw Error(
          'Wait for the company details to be found before saving a new company.',
        );
      next.companies.push({
        ticker: trade.ticker,
        name: txLookup.company!.name,
        sector: txLookup.company!.sector,
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
        : `${isNew ? `${trade.ticker} added to your companies. ` : ''}Transaction saved as a new line item. Holdings and average cost updated.`,
      {
        ...(isNew ? { createCompanies: [trade.ticker] } : {}),
        ...(isAll ? { target: { id: txDestination } } : {}),
      },
    );
    if (isNew) void queueQuoteRefresh([trade.ticker]);
    closeTx();
    if (pickQueue && !editing) openPick(pickQueue, pickQueue.index + 1);
  }
  async function recordStockSplit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!stockSplit) return;
    if (
      !transactionPortfolio().companies.some(
        (c) => c.ticker === stockSplit.ticker,
      )
    )
      throw Error('Choose a company you own.');
    const next = clone(transactionPortfolio());
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
      isAll ? { target: { id: txDestination } } : {},
    );
    closeTx();
  }
  async function recordDividend(e: React.FormEvent) {
    e.preventDefault();
    if (!dividend) return;
    if (
      !transactionPortfolio().companies.some(
        (c) => c.ticker === dividend.ticker,
      )
    )
      throw Error('Choose a company you own.');
    const next = clone(transactionPortfolio());
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
      isAll ? { target: { id: txDestination } } : {},
    );
    closeTx();
  }
  async function saveTickerRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const { from } = renaming;
    const to = renaming.to.trim().toUpperCase();
    // Strict create: the new symbol must exist in the PSX directory, so a typo can't be saved.
    await save(renameTicker(p!, from, to), `${from} is now ${to}.`, {
      createCompanies: [to],
    });
    void queueQuoteRefresh([to]);
    setRenaming(null);
    if (companyTicker === from) openCompany(to);
  }
  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    const next = clone(p!);
    const at = next.companies.findIndex((c) => c.ticker === company.ticker);
    if (creatingCompany) {
      if (at >= 0)
        throw Error(`${company.ticker} is already in your portfolio.`);
      if (!lookupReady(companyLookup, company.ticker))
        throw Error('Wait for the company details to be found before saving.');
    }
    const entry = creatingCompany
      ? {
          ...company,
          name: companyLookup.company!.name,
          sector: companyLookup.company!.sector,
        }
      : company;
    if (at >= 0) next.companies[at] = entry;
    else next.companies.push(entry);
    await save(
      next,
      creatingCompany
        ? `${company.ticker} added to your portfolio.`
        : undefined,
      creatingCompany ? { createCompanies: [company.ticker] } : {},
    );
    if (creatingCompany) void queueQuoteRefresh([company.ticker]);
    setCompany(null);
    setCreatingCompany(false);
  }
  return (
    <CompanyNavProvider value={openCompany}>
      <main className="desk">
        <ImportRequestRunner
          request={workspace?.importRequest ?? null}
          busy={busy}
          onRequest={(request) => {
            if (request.restore) {
              importActive.current = true;
              restoreBackup(request.file);
            } else processImportFile(request.file, request.expected);
          }}
        />
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <header className={'app-header' + (hideTabs ? ' no-tabs' : '')}>
            <div className="header-brand-group">
              <button
                type="button"
                data-slot="brand"
                className="brand"
                onClick={() => {
                  // The logo is home: the All portfolios view.
                  setTab('holdings');
                  workspace?.choose(ALL_PORTFOLIOS);
                }}
              >
                <LogoMark size={28} />
                <Wordmark />
              </button>
              {tab !== 'settings' && workspace?.selector}
            </div>
            <div className="header-right">
              {tab !== 'settings' && (
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
              )}
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
                              n.clearedAt
                                ? n
                                : { ...n, read: true, clearedAt: at },
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
                        {name && (
                          <span className="account-menu-name">{name}</span>
                        )}
                        <span className="account-menu-email">{email}</span>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setTab('settings')}>
                      <Settings size={15} /> Settings
                    </DropdownMenuItem>
                    {vault && (
                      <DropdownMenuItem onClick={vault.lock}>
                        <LockKeyhole size={15} /> Lock vault
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        track('signed_out');
                        void flushAnalytics().finally(() => {
                          window.location.href = '/api/auth/logout';
                        });
                      }}
                    >
                      <LogOut size={15} /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {!hideTabs && (
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
                {hasStocks && (
                  <TabsTrigger value="sip" title="Experimental feature">
                    <FlaskConical className="tab-icon tab-flask" aria-hidden="true" />
                    <span className="tab-long">Monthly Picks</span>
                    <span className="tab-short">Picks</span>
                  </TabsTrigger>
                )}
                {isAdmin && (
                  <TabsTrigger value="research-desk">
                    <FlaskConical className="tab-icon" aria-hidden="true" />
                    <span className="tab-long">Research desk</span>
                    <span className="tab-short">Research</span>
                  </TabsTrigger>
                )}
                {isAdmin && (
                  <TabsTrigger value="ai-lab">
                    <Microscope className="tab-icon" aria-hidden="true" />
                    <span className="tab-long">AI Lab</span>
                    <span className="tab-short">AI Lab</span>
                  </TabsTrigger>
                )}
              </TabsList>
            )}
          </header>
          <TabsContent value="holdings">
            {p.companies.length === 0 && !hasAssets ? (
              <div className="panel empty-holdings">
                <span className="empty-holdings-icon" aria-hidden="true">
                  <Briefcase size={26} />
                </span>
                <h2>Start your portfolio</h2>
                <p>
                  A portfolio can hold stocks, mutual funds, gold or silver and
                  savings plans. Choose what to add first; you can add the
                  others any time from the + button.
                </p>
                <StartTiles
                  disabled={busy}
                  onPick={pickAsset}
                  only={isAll || locked ? ['stock'] : undefined}
                />
                <div className="empty-holdings-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => emptyImportRef.current?.click()}
                  >
                    <Upload size={16} /> Import stocks from your broker
                  </button>
                  <input
                    ref={emptyImportRef}
                    type="file"
                    accept="application/pdf,.pdf,application/json,.json,text/csv,.csv,.xlsx"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) importFile(file);
                    }}
                  />
                </div>
                <small className="empty-holdings-hint">
                  Already have a broker statement? Choose it to review your
                  holdings and history before saving.
                </small>
              </div>
            ) : (
              <>
                {pendingCompanies.length > 0 && (
                  <p className="notice" role="status">
                    Company details for {pendingCompanies.join(', ')} are still
                    being looked up. Your transactions are saved; names and
                    sectors fill in automatically once PSX details are found. If
                    PSX renamed a symbol since you bought it, change it here:{' '}
                    {pendingCompanies.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => setRenaming({ from: t, to: '' })}
                      >
                        Change {t}
                      </button>
                    ))}{' '}
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => void load()}
                    >
                      Check again
                    </button>
                  </p>
                )}
                {!isAll && !locked && (
                  <div className="add-asset">
                    <AddAssetMenu onPick={pickAsset} disabled={busy} />
                  </div>
                )}
                {overviewParts && overviewParts.length > 1 ? (
                  <AccountOverview
                    parts={overviewParts}
                    asOf={today()}
                    metalRates={metalRates.rates}
                    fundNavs={fundData.navs}
                    planNavs={planNavs}
                    onOpenPortfolio={(id) => workspace?.choose(id)}
                    aside={
                      widePulse ? (
                        <PsxMarketPulse
                          ref={pulseRef}
                          onOpenShortlist={() => setTab('sip')}
                          onRefresh={refresh}
                          refreshing={busy}
                          {...pulseWatch}
                        />
                      ) : undefined
                    }
                    chart={
                      <PortfolioValueCard
                        chartOnly
                        p={p}
                        value={value}
                        cost={cost}
                        gain={gain}
                        heldCount={held.length}
                        missingCount={missing.length}
                        unknownCount={unknown.length}
                        newBuys={newBuys}
                      />
                    }
                  />
                ) : p.companies.length > 0 ? (
                  <PortfolioValueCard
                    p={p}
                    value={value}
                    cost={cost}
                    gain={gain}
                    heldCount={held.length}
                    missingCount={missing.length}
                    unknownCount={unknown.length}
                    newBuys={newBuys}
                    aside={
                      widePulse ? (
                        <PsxMarketPulse
                          ref={pulseRef}
                          onOpenShortlist={() => setTab('sip')}
                          onRefresh={refresh}
                          refreshing={busy}
                          {...pulseWatch}
                        />
                      ) : undefined
                    }
                  />
                ) : null}
                {p.companies.length > 0 && (
                  <CollapsiblePanel
                    id="stocks"
                    title={
                      overviewParts && overviewParts.length > 1
                        ? 'All companies'
                        : 'Your companies'
                    }
                    badge={`${held.length} ${held.length === 1 ? 'holding' : 'holdings'}`}
                    figures={[
                      {
                        label: 'Market value',
                        value:
                          missing.length && !value
                            ? 'Prices needed'
                            : moneyShort(value),
                      },
                      {
                        label: 'Remaining cost',
                        value: unknown.length
                          ? 'Not yet known'
                          : moneyShort(cost),
                      },
                      {
                        label: 'Gain / loss',
                        value:
                          gain === null ? 'Not yet known' : moneyShort(gain),
                        tone:
                          gain === null
                            ? ''
                            : gain >= 0
                              ? 'pos-text'
                              : 'neg-text',
                      },
                    ]}
                  >
                    <div className="holdings-head holdings-head--inline">
                      <button
                        className="secondary compact holdings-add holdings-targets"
                        disabled={busy || locked}
                        onClick={() =>
                          isAll ? setNamedAction(true) : setTargetsOpen(true)
                        }
                      >
                        Targets
                      </button>
                      <button
                        className="secondary compact holdings-add"
                        disabled={busy}
                        aria-label="Add company"
                        onClick={() => {
                          if (isAll) {
                            setNamedAction(true);
                            return;
                          }
                          if (locked) return;
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
                        <Plus size={15} />{' '}
                        <span className="holdings-add__label">Add company</span>
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
                            else if (holdingsSort?.key !== key)
                              toggleHoldingsSort(key);
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
                              <b className="ticker">{h.ticker}</b>
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
                                {gainPct(h) !== null && (
                                  <small>{gainText(h)}</small>
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Shares @ avg cost</dt>
                              <dd>
                                {h.shares.toLocaleString()}
                                <small>
                                  @{' '}
                                  {h.average === null ? '—' : money(h.average)}
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
                                    {h.quote.date !== today()
                                      ? ' · older quote'
                                      : ''}
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
                                    setQuotePrice(
                                      h.quote?.price.toString() ?? '',
                                    );
                                    setQuoteDate(h.quote?.date ?? today());
                                  }}
                                >
                                  {h.quote ? money(h.quote.price) : 'Add price'}
                                </button>
                                {h.quote && (
                                  <small>
                                    {h.quote.date}
                                    {h.quote.manual ? ' · manual' : ''}
                                    {h.quote.date !== today()
                                      ? ' · older quote'
                                      : ''}
                                  </small>
                                )}
                              </TableCell>
                              <TableCell>
                                {h.value === null ? '—' : moneyShort(h.value)}
                              </TableCell>
                              <TableCell className={gainClass(h)}>
                                {h.gain === null ? '—' : moneyShort(h.gain)}
                                {gainPct(h) !== null && (
                                  <small>{gainText(h)}</small>
                                )}
                              </TableCell>
                              <TableCell>
                                {!missing.length && value > 0 ? (
                                  <>
                                    <span>
                                      {(((h.value ?? 0) / value) * 100).toFixed(
                                        1,
                                      )}
                                      %
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
                              <TableCell>{holdingActions(h)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <p className="table-note">
                        A dash means unknown, not zero. Quotes may be delayed.
                        Market values exclude cash and unrecorded corporate
                        actions.
                      </p>
                    </section>
                  </CollapsiblePanel>
                )}
                {widePulse === false && (
                  <PsxMarketPulse
                    ref={pulseRef}
                    onOpenShortlist={() => setTab('sip')}
                    onRefresh={refresh}
                    refreshing={busy}
                    {...pulseWatch}
                  />
                )}
              </>
            )}
            <GoldSilverSection
              addRequest={assetAdd.kind === 'metal' ? assetAdd.n : 0}
              owned={ownedMetals}
              rates={metalRates.rates}
              ratesError={metalRates.error}
              canEdit={!isAll && !locked}
              busy={busy}
              onChange={(assets, message) =>
                save(
                  {
                    ...clone(p),
                    assets: [
                      ...(p.assets ?? []).filter((a) => a.kind !== 'metal'),
                      ...assets,
                    ],
                  },
                  message,
                )
              }
            />
            <SavingsPlansSection
              addRequest={assetAdd.kind === 'plan' ? assetAdd.n : 0}
              owned={ownedPlans}
              planNavs={planNavs}
              planNavsError={planNavData.loaded ? planNavData.error : ''}
              canEdit={!isAll && !locked}
              busy={busy}
              onChange={(plans, message) =>
                save(
                  {
                    ...clone(p),
                    assets: [
                      ...(p.assets ?? []).filter((a) => a.kind !== 'plan'),
                      ...plans,
                    ],
                  },
                  message,
                )
              }
            />
            <MutualFundsSection
              addRequest={assetAdd.kind === 'fund' ? assetAdd.n : 0}
              owned={ownedFunds}
              catalog={fundData.funds}
              navs={fundData.navs}
              catalogError={fundData.error || tracking.error}
              canEdit={!isAll && !locked}
              busy={busy}
              onChange={(funds, message) =>
                save(
                  {
                    ...clone(p),
                    assets: [
                      ...(p.assets ?? []).filter((a) => a.kind !== 'fund'),
                      ...funds,
                    ],
                  },
                  message,
                )
              }
            />
          </TabsContent>
          <TabsContent value="reports">
            {isAll ? (
              <AllReports
                portfolio={p}
                assets={allAssets.map((o) => o.asset)}
                metalRates={metalRates.rates}
                fundNavs={fundData.navs}
                planNavs={planNavs}
              />
            ) : reportMode(p) !== 'stocks' ? (
              <AssetReports
                portfolio={p}
                mode={reportMode(p) as 'savings' | 'metal'}
                metalRates={metalRates.rates}
                fundNavs={fundData.navs}
                planNavs={planNavs}
              />
            ) : (
              <PortfolioReports portfolio={p} />
            )}
          </TabsContent>
          <TabsContent value="sip">
            {!hasStocks ? (
              <div className="panel empty-holdings">
                <h2>Monthly Picks needs a stock</h2>
                <p>
                  Monthly Picks works on PSX stocks. Add or import a stock and
                  the tab will appear.
                </p>
              </div>
            ) : (
              <MonthlyPicks
                portfolio={picksPortfolio ?? p}
                month={month}
                setMonth={setMonth}
                feePct={fees}
                setFeePct={setFees}
                busy={busy}
                onSave={async (next, message) => {
                  if (!picksHome || workspace!.account.portfolios.length < 2)
                    return save(next, message);
                  await save(
                    {
                      ...picksHome.portfolio,
                      monthlyPicksShortlist: next.monthlyPicksShortlist,
                      monthlyPicksList: next.monthlyPicksList,
                      budgets: next.budgets,
                      monthlyPicksRuns: next.monthlyPicksRuns,
                    },
                    message,
                    { target: { id: picksHome.id }, reload: true },
                  );
                }}
                onRecordBuys={recordPicks}
                onRefreshPrices={refresh}
                onOpenCompany={openCompany}
                onManualPrice={(ticker) => {
                  setQuoteTicker(ticker);
                  setQuotePrice(String(p.quotes[ticker]?.price ?? ''));
                  setQuoteDate(p.quotes[ticker]?.date ?? today());
                }}
              />
            )}
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
              <p>
                Every buy, sale, dividend and split, including gold, savings
                plans and mutual funds, newest first.
              </p>
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
                    hs.find((h) => h.ticker === companyTicker)?.quote?.price ??
                      null,
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
                onChangeTicker={() =>
                  setRenaming({ from: companyTicker, to: '' })
                }
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
          {isAdmin && (
            <TabsContent value="ai-lab">
              <AiLab
                portfolio={p}
                busy={busy}
                onSave={save}
                onOpenCompany={openCompany}
              />
            </TabsContent>
          )}
          <TabsContent value="settings">
            <SettingsView
              key={settingsEntry.n}
              initialSection={settingsEntry.section}
              name={name}
              email={email!}
              picture={picture}
              role={role}
              busy={busy}
              usage={usage}
              filerStatus={p.taxProfile?.filerStatus ?? ''}
              researchSettings={p.researchSettings ?? DEFAULT_RESEARCH_SETTINGS}
              portfolios={workspace?.manager}
              onBack={() => setTab('holdings')}
              onFilerStatus={saveFilerStatus}
              onResearchSettings={saveResearchSettings}
              onExport={exportBackup}
              onExportEncrypted={exportEncryptedBackup}
              onClearLedger={async () => {
                if (!vault || vault.session.revision === null)
                  throw Error('Unlock your account first.');
                await vault.session.saveAccount(
                  accountFromPortfolio(),
                  vault.session.revision,
                  { replaceAll: true },
                );
              }}
              onRestore={(file) =>
                workspace
                  ? workspace.requestImport(file, undefined, true)
                  : restoreBackup(file)
              }
              security={
                vault ? (
                  <VaultSecurity session={vault.session} onLock={vault.lock} />
                ) : undefined
              }
              onImportFile={importFile}
              importSummary={summarizeImports(p)}
              dividendSync={
                <DividendSyncView
                  portfolio={p}
                  revision={revision}
                  busy={busy}
                  onSave={async (next, message) => {
                    await save(next, message);
                  }}
                />
              }
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
        {locked ? (
          <p className="notice">
            This portfolio is locked. Unlock it in Settings → Portfolios to make
            changes.
          </p>
        ) : null}
        {importRefreshError ? (
          <p className="notice error">
            Your import is saved. {importRefreshError}{' '}
            <button
              className="secondary compact"
              onClick={() =>
                void refreshImported(p.companies.map((c) => c.ticker))
              }
            >
              Retry refresh
            </button>
          </p>
        ) : null}
        <footer>
          <div className="row">
            <span>All amounts in PKR · Private saved ledger</span>
          </div>
        </footer>
        {confirmDialog}
        <EncryptedRestoreDialog
          backup={encryptedRestore}
          onCancel={() => setEncryptedRestore(null)}
          onRestore={async (portfolio) => {
            await vault!.session.saveAccount(
              portfolio,
              vault!.session.revision,
              { replaceAll: true },
            );
            await load();
            setEncryptedRestore(null);
          }}
        />
        {ahlStatement && (
          <AhlImportDialog
            statement={ahlStatement.statement}
            fileName={`${ahlStatement.fileName} · ${destinationName}`}
            portfolio={p}
            revision={revision}
            busy={busy}
            onCancel={() => {
              importActive.current = false;
              importHash.current = undefined;
              setAhlStatement(null);
            }}
            onCommit={async (next, message) => {
              await save(next, message + unknownCostWarning(next));
              setAhlStatement(null);
            }}
          />
        )}
        {finqalabReview && (
          <FinqalabImportDialog
            rows={finqalabReview.rows}
            fileName={`${finqalabReview.fileName} · ${destinationName}`}
            portfolio={p}
            revision={revision}
            busy={busy}
            onCancel={() => {
              importActive.current = false;
              importHash.current = undefined;
              setFinqalabReview(null);
            }}
            onCommit={async (next, message) => {
              await save(next, message + unknownCostWarning(next));
              setFinqalabReview(null);
            }}
          />
        )}
        {brokerReview && (
          <BrokerImportDialog
            statement={brokerReview.statement}
            fileName={`${brokerReview.fileName} · ${destinationName}`}
            portfolio={p}
            revision={revision}
            busy={busy}
            method={brokerReview.method}
            mappingReady={!!brokerReview.format}
            onCancel={() => {
              importActive.current = false;
              importHash.current = undefined;
              setBrokerReview(null);
            }}
            onCommit={async (next, message, broker) => {
              if (
                brokerReview.format &&
                !(next.brokerFormats ?? []).some(
                  (f) =>
                    f.signature === brokerReview.format!.signature &&
                    f.broker === broker,
                )
              )
                next.brokerFormats = [
                  ...(next.brokerFormats ?? []),
                  { ...brokerReview.format, broker },
                ];
              next.brokerFileHashes = [
                ...(next.brokerFileHashes ?? []),
                brokerReview.hash,
              ];
              await save(next, message + unknownCostWarning(next));
              setBrokerReview(null);
            }}
          />
        )}
        {ipoReview && (
          <IpoImportDialog
            items={ipoReview.items}
            fileName={`${ipoReview.fileName} · ${destinationName}`}
            portfolio={p}
            revision={revision}
            busy={busy}
            onCancel={() => {
              importActive.current = false;
              importHash.current = undefined;
              setIpoReview(null);
            }}
            onCommit={async (next, message) => {
              await save(next, message + unknownCostWarning(next));
              setIpoReview(null);
            }}
          />
        )}
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
              const txP = isAll && txDestination ? transactionPortfolio() : p;
              const correcting = !!(
                editing ||
                editingDividend ||
                editingStockSplit
              );
              const t = trade,
                d = dividend,
                sp = stockSplit;
              const ticker =
                txType === 'dividend'
                  ? d?.ticker
                  : txType === 'split'
                    ? sp?.ticker
                    : t?.ticker;
              const owned =
                !!ticker && txP.companies.some((c) => c.ticker === ticker);
              const isTrade =
                txType === 'buy' || txType === 'sell' || txType === 'opening';
              const addNew =
                !correcting &&
                isTrade &&
                txType !== 'sell' &&
                !!ticker &&
                !owned &&
                /^[A-Z0-9]{2,12}$/.test(ticker);
              const date =
                (isTrade
                  ? t?.date
                  : txType === 'dividend'
                    ? d?.date
                    : sp?.date) ?? '';
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
                    const next = clone(txP);
                    next.trades.find((x) => x.id === editing)!.voided = true;
                    await save(
                      next,
                      'Entry voided.',
                      isAll ? { target: { id: txDestination } } : {},
                    );
                    closeTx();
                  });
                } else if (editingDividend) {
                  if (!(await ok())) return;
                  attempt(async () => {
                    const next = clone(txP);
                    next.dividends!.find(
                      (x) => x.id === editingDividend,
                    )!.voided = true;
                    await save(
                      next,
                      'Dividend record voided.',
                      isAll ? { target: { id: txDestination } } : {},
                    );
                    closeTx();
                  });
                } else if (editingStockSplit) {
                  if (!(await ok())) return;
                  attempt(async () => {
                    const next = clone(txP);
                    next.stockSplits!.find(
                      (x) => x.id === editingStockSplit,
                    )!.voided = true;
                    await save(
                      next,
                      'Stock split voided.',
                      isAll ? { target: { id: txDestination } } : {},
                    );
                    closeTx();
                  });
                }
              };
              return (
                <>
                  <DialogTitle>
                    {pickQueue
                      ? `Pick ${pickQueue.index + 1} of ${pickQueue.picks.length} · ${title}`
                      : title}
                  </DialogTitle>
                  <DialogDescription>{description}</DialogDescription>
                  {workspace &&
                  workspace.account.portfolios.length > 1 &&
                  !correcting ? (
                    <label className="tx-destination">
                      Portfolio
                      <select
                        aria-label="Transaction portfolio"
                        value={txDestination}
                        disabled={busy}
                        required
                        onChange={(e) => {
                          setTxDestination(e.target.value);
                          patchTx({ ticker: '' });
                        }}
                      >
                        <option value="" disabled>
                          Choose portfolio
                        </option>
                        {workspace.account.portfolios.map((entry) => (
                          <option
                            key={entry.id}
                            value={entry.id}
                            disabled={entry.locked}
                          >
                            {entry.name}
                            {entry.locked ? ' · locked' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
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
                    <fieldset
                      disabled={busy || locked || (isAll && !txDestination)}
                      className="tx-fields"
                    >
                      {!correcting && (
                        <fieldset className="tx-types">
                          <legend className="sr-only">Transaction type</legend>
                          {TX_TYPES.map((x) => (
                            <button
                              key={x.type}
                              type="button"
                              aria-pressed={txType === x.type}
                              className={
                                txType === x.type
                                  ? 'compact'
                                  : 'secondary compact'
                              }
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
                            companies={txP.companies}
                            allowNew={
                              !correcting && isTrade && txType !== 'sell'
                            }
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
                                It is not in your portfolio yet. Its name and
                                sector come from the shared PSX company
                                directory; the company and this entry are saved
                                together.
                              </span>
                            </p>
                            <CompanyLookupNote
                              lookup={txLookup}
                              ticker={ticker ?? ''}
                            />
                            <div className="form-grid">
                              <label>
                                Company name
                                <input
                                  readOnly
                                  value={
                                    lookupReady(txLookup, ticker ?? '')
                                      ? txCompany.name
                                      : ''
                                  }
                                  placeholder="Found from the PSX directory"
                                />
                              </label>
                              <label>
                                Sector
                                <input
                                  readOnly
                                  value={
                                    lookupReady(txLookup, ticker ?? '')
                                      ? txCompany.sector
                                      : ''
                                  }
                                  placeholder="Found from the PSX directory"
                                />
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
                                onChange={(e) =>
                                  setTrade({
                                    ...t,
                                    shares: Number(e.target.value),
                                  })
                                }
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
                                    price:
                                      e.target.value === ''
                                        ? null
                                        : Number(e.target.value),
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
                                onChange={(e) =>
                                  setTrade({
                                    ...t,
                                    fees: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                            {txType === 'buy' && (
                              <label>
                                SIP month (optional)
                                <input
                                  type="month"
                                  value={t.month}
                                  onChange={(e) =>
                                    setTrade({ ...t, month: e.target.value })
                                  }
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
                              onChange={(e) =>
                                setDividend({
                                  ...d,
                                  perShare: Number(e.target.value),
                                })
                              }
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
                                  setStockSplit({
                                    ...sp,
                                    oldShares: Number(e.target.value),
                                  })
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
                                  setStockSplit({
                                    ...sp,
                                    newShares: Number(e.target.value),
                                  })
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
                            value={
                              (isTrade
                                ? t?.note
                                : txType === 'dividend'
                                  ? d?.note
                                  : sp?.note) ?? ''
                            }
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
                      {txType === 'dividend' &&
                        d &&
                        (() => {
                          const shares = d.ticker
                            ? sharesHeldOn(txP, d.ticker, d.date)
                            : 0;
                          const gross = round((d.perShare ?? 0) * shares);
                          const rate = txP.taxProfile
                            ? txP.taxProfile.filerStatus === 'filer'
                              ? 0.15
                              : 0.3
                            : null;
                          return (
                            <p>
                              {shares} shares held on {d.date} · Gross{' '}
                              {money(gross)}
                              {rate === null
                                ? ' · Set your filer status in Settings to estimate tax.'
                                : ` · Tax ${money(round(gross * rate))} · Net ${money(round(gross * (1 - rate)))}`}
                            </p>
                          );
                        })()}
                      {txType === 'split' &&
                        sp &&
                        (() => {
                          if (
                            !sp.ticker ||
                            sp.oldShares <= 0 ||
                            sp.newShares <= 0
                          )
                            return (
                              <p className="muted">
                                Pick a company and enter the old and new share
                                counts to see a preview.
                              </p>
                            );
                          try {
                            const base = clone(txP);
                            if (editingStockSplit) {
                              const old = (base.stockSplits ?? []).find(
                                (x) => x.id === editingStockSplit,
                              );
                              if (old) old.voided = true;
                            }
                            const before = sharesHeldBefore(
                              base,
                              sp.ticker,
                              sp.date,
                            );
                            const after =
                              (before * sp.newShares) / sp.oldShares;
                            const preview = clone(base);
                            preview.stockSplits ??= [];
                            preview.stockSplits.push(sp);
                            validate(preview);
                            const result = holdings(preview).find(
                              (x) => x.ticker === sp.ticker,
                            );
                            return (
                              <div className="mini-stat split-preview">
                                <span>Preview</span>
                                <b>
                                  {before.toLocaleString()} →{' '}
                                  {after.toLocaleString()} shares on {sp.date}
                                </b>
                                <small>
                                  Current:{' '}
                                  {result?.shares.toLocaleString() ?? '—'}{' '}
                                  shares · Total cost{' '}
                                  {result?.cost === null
                                    ? 'unknown'
                                    : money(result?.cost ?? null)}{' '}
                                  · Average{' '}
                                  {result?.average === null
                                    ? 'unknown'
                                    : money(result?.average ?? null)}
                                </small>
                              </div>
                            );
                          } catch (error) {
                            return (
                              <p className="notice error">
                                {error instanceof Error
                                  ? error.message
                                  : String(error)}
                              </p>
                            );
                          }
                        })()}
                      <div className="row tx-actions">
                        <button
                          disabled={
                            busy ||
                            (addNew && !lookupReady(txLookup, ticker ?? ''))
                          }
                          type="submit"
                        >
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
                            onClick={() =>
                              openPick(pickQueue, pickQueue.index + 1)
                            }
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
                    </fieldset>
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
              Confirm that the cash arrived. Leave the amounts blank to keep
              PSX&apos;s expected figure with estimated tax, or enter what your
              broker / CDC statement shows.
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
                      onChange={(e) =>
                        setReceipt({ ...receipt, paymentDate: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Actual gross amount (PKR, optional)
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={receipt.gross}
                      onChange={(e) =>
                        setReceipt({ ...receipt, gross: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Tax withheld (PKR, optional)
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={receipt.tax}
                      onChange={(e) =>
                        setReceipt({ ...receipt, tax: e.target.value })
                      }
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
                    {creatingCompany ? (
                      <input
                        readOnly
                        value={
                          lookupReady(companyLookup, company.ticker)
                            ? company.name
                            : ''
                        }
                        placeholder="Found from the PSX directory"
                      />
                    ) : (
                      <input
                        required
                        maxLength={150}
                        value={company.name}
                        onChange={(e) =>
                          setCompany({ ...company, name: e.target.value })
                        }
                      />
                    )}
                  </label>
                  <label>
                    Sector
                    {creatingCompany ? (
                      <input
                        readOnly
                        value={
                          lookupReady(companyLookup, company.ticker)
                            ? company.sector
                            : ''
                        }
                        placeholder="Found from the PSX directory"
                      />
                    ) : (
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
                        {Array.from(
                          new Set([
                            ...SECTORS,
                            ...sectorsInUse,
                            ...(company.sector ? [company.sector] : []),
                          ]),
                        )
                          .sort()
                          .map((sector) => (
                            <option key={sector} value={sector}>
                              {sector}
                            </option>
                          ))}
                      </select>
                    )}
                  </label>
                  {creatingCompany && (
                    <div className="wide">
                      <CompanyLookupNote
                        lookup={companyLookup}
                        ticker={company.ticker}
                      />
                    </div>
                  )}
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
                        setCompany({
                          ...company,
                          target: Number(e.target.value),
                        })
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
                          // A value typed here is the account's own, no longer an assumption.
                          faceValueAssumed: undefined,
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
                    ? 'Enter the PSX symbol; the company name and sector come from the shared PSX company directory and cannot be edited.'
                    : 'This existing symbol has already been created in your portfolio.'}{' '}
                  Screens older than 183 days pause new allocations. Total
                  targets must equal 100%; calculator caps new exposure at 20%
                  per company.
                </p>
                <button
                  disabled={
                    busy ||
                    (creatingCompany &&
                      !lookupReady(companyLookup, company.ticker))
                  }
                >
                  Save company
                </button>
              </form>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!renaming}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
        >
          <DialogContent className="form-dialog">
            <DialogTitle>Change PSX symbol</DialogTitle>
            <DialogDescription>
              Use this when a company is listed under a new symbol, for example
              WPFL became WAHDAT after its IPO. All of its trades, splits and
              dividends move to the new symbol.
            </DialogDescription>
            {renaming && (
              <form onSubmit={(e) => attempt(() => saveTickerRename(e))}>
                <label>
                  Current symbol
                  <input readOnly value={renaming.from} />
                </label>
                <label>
                  New symbol
                  <input
                    required
                    autoFocus
                    pattern="[A-Z0-9]{2,12}"
                    value={renaming.to}
                    onChange={(e) =>
                      setRenaming({
                        ...renaming,
                        to: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
                <p className="muted">
                  The new symbol must exist in the PSX company directory.
                </p>
                <button disabled={busy || !renaming.to}>Change symbol</button>
              </form>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={namedAction} onOpenChange={setNamedAction}>
          <DialogContent className="form-dialog">
            <DialogTitle>Choose a portfolio</DialogTitle>
            <DialogDescription>
              Open a portfolio to change its companies or SIP settings.
            </DialogDescription>
            <div className="portfolio-action-choices">
              {workspace?.account.portfolios.map((part) => (
                <button
                  key={part.id}
                  className="secondary"
                  disabled={part.locked}
                  onClick={() => workspace.choose(part.id)}
                >
                  {part.name}
                  {part.locked ? ' · locked' : ''}
                </button>
              ))}
            </div>
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
