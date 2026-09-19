'use client';
import { useEffect, useState } from 'react';
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
import { Spinner } from '@/components/ui/spinner';
import {
  ArrowUpRight,
  RefreshCw,
  Plus,
  Download,
  Sparkles,
  Wallet,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import {
  holdings,
  plan,
  money,
  today,
  round,
  validate,
  SECTORS,
  type Portfolio,
  type Trade,
  type Company,
  type Sector,
} from '@/lib/portfolio';
import PortfolioReports from './portfolio-reports';
import ResearchDesk from './research-desk';
import PsxMarketPulse from './psx-market-pulse';
import AiReview from './ai-review';

const TAB_PATHS: Record<string, string> = {
  holdings: '/',
  reports: '/reports',
  sip: '/sip',
  history: '/history',
  'research-desk': '/research-desk',
  research: '/research',
};
const PATH_TABS: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
);
function tabFromPathname(pathname: string): string {
  return PATH_TABS[pathname] ?? 'holdings';
}
const SIGNIN_TICKERS: { ticker: string; up: boolean }[] = [
  { ticker: 'MEBL', up: true },
  { ticker: 'OGDC', up: true },
  { ticker: 'LUCK', up: false },
  { ticker: 'FFC', up: true },
  { ticker: 'MARI', up: true },
  { ticker: 'PSO', up: false },
  { ticker: 'SYS', up: true },
  { ticker: 'FATIMA', up: true },
];
const SIGNIN_CANDLES: [number, number][] = [
  [18, 24],
  [24, 21],
  [21, 30],
  [30, 27],
  [27, 36],
  [36, 43],
  [43, 39],
  [39, 49],
  [49, 56],
  [56, 51],
  [51, 61],
  [61, 68],
  [68, 63],
  [63, 72],
  [72, 80],
  [80, 88],
];
function SignInChart() {
  const width = 640,
    height = 220,
    gap = width / SIGNIN_CANDLES.length;
  const scale = (v: number) => height - 20 - v * 1.9;
  return (
    <svg
      className="signin-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {SIGNIN_CANDLES.map(([open, close], i) => {
        const x = i * gap + gap / 2;
        const up = close >= open;
        const color = up ? '#22e0a0' : '#ff5d6c';
        const bodyTop = scale(Math.max(open, close));
        const bodyBottom = scale(Math.min(open, close));
        return (
          <g key={i} stroke={color} fill={color}>
            <line
              x1={x}
              x2={x}
              y1={scale(Math.max(open, close) + 4)}
              y2={scale(Math.min(open, close) - 4)}
              strokeWidth={1.5}
            />
            <rect
              x={x - gap * 0.28}
              y={bodyTop}
              width={gap * 0.56}
              height={Math.max(bodyBottom - bodyTop, 2)}
            />
          </g>
        );
      })}
    </svg>
  );
}
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

type ApiResponse = {
  error?: string;
  portfolio: Portfolio;
  revision: number;
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
  error?: string;
};
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
const cashAmount = (t: Trade) =>
  t.price === null
    ? null
    : t.shares * t.price + (t.kind === 'sell' ? -t.fees : t.fees);
const kindLabel = (t: Trade) =>
  t.kind === 'opening' ? 'Opening' : t.kind === 'sell' ? 'Sale' : 'Purchase';
function ledgerGroups(trades: Trade[], ticker = '') {
  const groups = new Map<string, Trade[]>();
  for (const t of [...trades]
    .filter((entry) => !ticker || entry.ticker === ticker)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))) {
    const rows = groups.get(t.ticker) ?? [];
    rows.push(t);
    groups.set(t.ticker, rows);
  }
  return [...groups.entries()];
}
function TradeHistoryTable({
  trades,
  onCorrect,
}: {
  trades: Trade[];
  onCorrect: (t: Trade) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            'Date',
            'Type',
            'Shares',
            'Price',
            'Fees',
            'Cash amount',
            'SIP month',
            '',
          ].map((x) => (
            <TableHead key={x}>{x}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((t) => (
          <TableRow key={t.id} style={{ opacity: t.voided ? 0.5 : 1 }}>
            <TableCell>{t.date}</TableCell>
            <TableCell>
              {t.voided ? 'Voided · ' : ''}
              {kindLabel(t)}
            </TableCell>
            <TableCell>{t.shares.toLocaleString()}</TableCell>
            <TableCell>{money(t.price)}</TableCell>
            <TableCell>{money(t.fees)}</TableCell>
            <TableCell>
              {cashAmount(t) === null ? 'Unknown' : money(cashAmount(t))}
            </TableCell>
            <TableCell>{t.month || '—'}</TableCell>
            <TableCell>
              {!t.voided && (
                <button
                  className="secondary compact"
                  onClick={() => onCorrect(t)}
                >
                  Correct
                </button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export default function Dashboard({ email }: { email: string | null }) {
  const initialPathname = usePathname();
  const [tab, setTabState] = useState(() => tabFromPathname(initialPathname));
  function setTab(next: string) {
    setTabState(next);
    const path = TAB_PATHS[next] ?? '/';
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  }
  useEffect(() => {
    function onPopState() {
      setTabState(tabFromPathname(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [p, setP] = useState<Portfolio | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [fees, setFees] = useState(0),
    [allowOld, setAllowOld] = useState(false);
  const [trade, setTrade] = useState<Trade | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [company, setCompany] = useState<Company | null>(null),
    [quoteTicker, setQuoteTicker] = useState(''),
    [quotePrice, setQuotePrice] = useState(''),
    [quoteDate, setQuoteDate] = useState(today()),
    [proposal, setProposal] = useState<{
      summary: string;
      weights: Record<string, number>;
    } | null>(null),
    [reviewBusy, setReviewBusy] = useState(false),
    [historyTicker, setHistoryTicker] = useState('');
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
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(
    next: Portfolio,
    success = 'Saved to your private portfolio.',
  ) {
    if (busy || reviewBusy)
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
      setProposal(null);
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
  if (!p)
    return (
      <main className="signin">
        <section className="signin-hero">
          <div className="brand">
            <Wallet size={26} />
            <span>PSX / PERSONAL INVESTING</span>
          </div>
          <div className="signin-hero-copy">
            <h1>Every rupee you&rsquo;ve put into PSX, in one ledger.</h1>
            <p>
              Purchases, prices and your monthly SIP plan, tracked the way
              you actually invest, not how a spreadsheet assumes you should.
            </p>
          </div>
          <SignInChart />
          <div className="signin-ticker" aria-hidden="true">
            <div className="signin-ticker-track">
              {[...SIGNIN_TICKERS, ...SIGNIN_TICKERS].map((t, i) => (
                <span key={i}>
                  {t.ticker} <span className={t.up ? 'up' : 'down'}>{t.up ? '▲' : '▼'}</span>
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="signin-panel">
          <div className="signin-card">
            <p className="signin-kicker">Portfolio & SIP desk</p>
            <h2>Sign in to continue</h2>
            <p className="muted">
              {busy
                ? 'Loading your holdings and purchase history…'
                : 'Your holdings stay private to your Google account.'}
            </p>
            <a
              className="google-btn"
              href="/api/auth/google/login?return_to=%2F"
              target="_top"
            >
              <GoogleMark /> Continue with Google
            </a>
            {message && !message.includes('Sign in to access your portfolio') && (
              <p role="alert" className="notice error">
                {message}
              </p>
            )}
            <button className="secondary" onClick={load}>
              Retry loading
            </button>
          </div>
        </section>
      </main>
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
    gain = cost === null || missing.length ? null : round(value - cost),
    calc = plan(p, month, fees, allowOld),
    budget = p.budgets[month] ?? 100000;
  const newBuys = round(
    p.trades
      .filter((t) => t.kind === 'buy' && !t.voided)
      .reduce((a, t) => a + t.shares * t.price! + t.fees, 0),
  );
  const historyGroups = ledgerGroups(p.trades, historyTicker);
  function openHistory(ticker: string) {
    setHistoryTicker(ticker);
    setTab('history');
  }
  function correctTrade(t: Trade) {
    setEditing(t.id);
    setTrade({ ...t });
  }
  async function refresh() {
    setBusy(true);
    try {
      notify('Fetching PSX prices…');
      const r = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: p!.companies.map((c) => c.ticker) }),
      });
      const d = (await r.json()) as QuoteRefreshResponse;
      if (!r.ok) throw Error(d.error);
      const next = { ...p!, quotes: { ...p!.quotes, ...d.quotes } };
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
      setProposal(null);
      notify(
        `${Object.keys(d.quotes).length} PSX prices refreshed.${d.errors.length ? ' Unavailable: ' + d.errors.join(', ') + '. Previous quotes retained.' + (d.reasons ? ' Reason: ' + [...new Set(Object.values(d.reasons))].join(' | ') : '') : ''}`,
        !!d.errors.length,
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
    setHistoryTicker(entry.ticker);
    setTab('history');
  }
  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    const next = clone(p!);
    const at = next.companies.findIndex((c) => c.ticker === company.ticker);
    if (at >= 0) next.companies[at] = company;
    else next.companies.push(company);
    await save(next);
    setCompany(null);
  }
  return (
    <main className="desk">
      <header>
        <div className="brand">
          <Wallet size={29} />
          <span>PSX / PERSONAL INVESTING</span>
        </div>
        <div className="header-right">
          <span className="badge">
            <ShieldCheck size={14} /> PRIVATE WORKSPACE
          </span>
          {email && (
            <span className="account-chip">
              <span className="account-email">{email}</span>
              <a className="signout-link" href="/api/auth/logout">
                <LogOut size={13} />
                Sign out
              </a>
            </span>
          )}
        </div>
      </header>
      <section className="heading">
        <div>
          <p className="eyebrow">YOUR LONG-TERM PICTURE</p>
          <h1>Portfolio & SIP desk</h1>
          <p>
            A clear record of what you own. A considered plan for what comes
            next.
          </p>
        </div>
        <div className="row">
          <button
            className="secondary"
            disabled={busy || reviewBusy}
            onClick={refresh}
          >
            <RefreshCw size={16} /> Refresh PSX prices
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setTrade(blankTrade(historyTicker || 'MEBL'));
            }}
          >
            <Plus size={17} /> Record a purchase
          </button>
        </div>
      </section>
      {message && (
        <div
          role={failed ? 'alert' : 'status'}
          className={'notice ' + (failed ? 'error' : 'success')}
        >
          {message}
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="sip">Monthly SIP</TabsTrigger>
          <TabsTrigger value="history">Purchase log</TabsTrigger>
          <TabsTrigger value="research-desk">Research desk</TabsTrigger>
          <TabsTrigger value="research">AI review</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings">
          <PsxMarketPulse />
          <div className="metrics">
        <article>
          <span>
            {missing.length
              ? 'Priced holdings · incomplete'
              : 'Portfolio market value'}
          </span>
          <strong className="amount">
            {missing.length === held.length ? 'Prices needed' : money(value)}
          </strong>
          <small>
            {missing.length
              ? `${missing.length} holdings need a price`
              : `${held.length} holdings · each quote dated below`}
          </small>
        </article>
        <article>
          <span>Total remaining cost</span>
          <strong className="amount">{money(cost)}</strong>
          <small>
            {unknown.length
              ? `${unknown.length} holdings have unknown opening costs`
              : `New purchases recorded: ${money(newBuys)}`}
          </small>
        </article>
        <article>
          <span>Unrealised gain / loss</span>
          <strong
            className="amount"
            style={{
              color:
                gain === null ? 'inherit' : gain >= 0 ? '#22e0a0' : '#ff5d6c',
            }}
          >
            {gain === null ? 'Not yet known' : money(gain)}
          </strong>
          <small>
            {gain === null
              ? 'Requires all opening costs and prices'
              : 'Market value less remaining cost, including buy fees'}
          </small>
        </article>
      </div>
          <div className="section-top">
            <div>
              <h2>Your companies</h2>
              <p>
                Opening quantities: CDC statement, 9 September 2026. Statement
                value: Rs 788,743.
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                setCompany({
                  ticker: '',
                  name: '',
                  sector: '',
                  target: 0,
                  approved: false,
                  screenDate: '',
                  note: '',
                })
              }
            >
              <Plus size={16} /> Add company
            </button>
          </div>
          <section className="panel table-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Company',
                    'Shares',
                    'Avg. cost',
                    'Latest price',
                    'Market value',
                    'Gain / loss',
                    'Portfolio weight',
                    '',
                  ].map((x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {hs.map((h) => (
                  <TableRow key={h.ticker}>
                    <TableCell>
                      <button
                        className="quote-btn ticker"
                        onClick={() => openHistory(h.ticker)}
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
                      <div className="row">
                        <button
                          className="secondary compact"
                          onClick={() => openHistory(h.ticker)}
                        >
                          History
                        </button>
                        {h.shares > 0 && (
                          <button
                            className="secondary compact"
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
                          </button>
                        )}
                        <button
                          className="secondary compact"
                          onClick={() =>
                            setCompany({
                              ...p.companies.find(
                                (c) => c.ticker === h.ticker,
                              )!,
                            })
                          }
                        >
                          Edit
                        </button>
                      </div>
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
          <div className="two-col">
            <section className="panel">
              <p className="eyebrow">MONTHLY CONTRIBUTION</p>
              <h2>Make room for your next investment.</h2>
              <div className="form-grid">
                <label>
                  SIP month
                  <input
                    type="month"
                    value={month}
                    disabled={reviewBusy}
                    onChange={(e) => {
                      setMonth(e.target.value || today().slice(0, 7));
                      setProposal(null);
                    }}
                  />
                </label>
                <label>
                  Monthly budget (PKR)
                  <input
                    key={month + '-' + budget}
                    type="number"
                    min="0"
                    max="1000000000"
                    step="0.01"
                    defaultValue={budget}
                    onBlur={(e) => {
                      const amount = Number(e.target.value);
                      if (amount !== budget)
                        attempt(() =>
                          save(
                            {
                              ...p,
                              budgets: { ...p.budgets, [month]: amount },
                            },
                            'Monthly budget saved.',
                          ),
                        );
                    }}
                  />
                </label>
                <label>
                  Estimated fees (%)
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.01"
                    value={fees}
                    onChange={(e) => setFees(Number(e.target.value))}
                  />
                </label>
                <div className="mini-stat">
                  <span>Already purchased this month</span>
                  <b>{money(calc.already)}</b>
                </div>
              </div>
              <label className="check-row">
                <Checkbox
                  checked={allowOld}
                  onCheckedChange={(v) => setAllowOld(!!v)}
                />{' '}
                Allow dated, latest-available quotes when today’s quotes are
                unavailable
              </label>
              <p className="muted">
                Uses remaining SIP budget and all priced holdings to fill target
                gaps. New purchases are capped at 20% per company; whole shares
                and estimated fees stay within your budget.
              </p>
            </section>
            <aside className="panel accent">
              <p className="eyebrow">AVAILABLE THIS MONTH</p>
              <div className="big-number">{money(calc.remaining)}</div>
              <div className="split-stats">
                <div>
                  <small>Planned purchases</small>
                  <strong>{money(calc.invested)}</strong>
                </div>
                <div>
                  <small>Cash left over</small>
                  <strong>{money(calc.leftover)}</strong>
                </div>
              </div>
              <p>
                Overweight positions receive no new allocation. Unused cash
                stays unallocated when targets, screening, or whole-share prices
                prevent a purchase.
              </p>
              <button className="light-btn" onClick={() => setTab('research')}>
                <Sparkles size={16} /> Review with AI <ArrowUpRight size={16} />
              </button>
            </aside>
          </div>
          {calc.errors.length > 0 && (
            <div role="alert" className="notice">
              {calc.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
          <div className="section-top">
            <div>
              <h2>Suggested purchase breakdown</h2>
              <p>
                {calc.errors.length
                  ? 'Resolve the checks above to calculate quantities.'
                  : 'Automatically recalculates as your holdings, prices and targets change.'}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() =>
                download(
                  `sip-${month}.json`,
                  JSON.stringify(
                    {
                      ...calc,
                      month,
                      feePct: fees,
                      createdAt: new Date().toISOString(),
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              <Download size={16} /> Export plan
            </button>
          </div>
          <section className="panel table-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Company',
                    'Current → target',
                    'Price used',
                    'Whole shares',
                    'Estimated spend',
                    'Why',
                  ].map((x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.rows.map((r) => (
                  <TableRow key={r.ticker}>
                    <TableCell className="ticker">{r.ticker}</TableCell>
                    <TableCell>
                      {missing.length ? '?' : r.currentWeight.toFixed(1)}% →{' '}
                      {r.target}%
                    </TableCell>
                    <TableCell>
                      {money(r.price)}
                      <small>{r.asOf}</small>
                    </TableCell>
                    <TableCell>{calc.errors.length ? '—' : r.shares}</TableCell>
                    <TableCell>
                      {calc.errors.length ? '—' : money(r.amount)}
                    </TableCell>
                    <TableCell>{r.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="table-note">
              This is a target-based calculator, not an AI recommendation or an
              order. Record the actual execution price after purchasing.
            </p>
          </section>
          <div className="section-top">
            <h2>SIP targets & purchase eligibility</h2>
            <span>
              Total target:{' '}
              {p.companies.reduce((s, c) => s + c.target, 0).toFixed(1)}%
            </span>
          </div>
          <div className="target-grid">
            {p.companies
              .filter((c) => c.target > 0)
              .map((c) => (
                <button
                  className="target-card"
                  key={c.ticker}
                  onClick={() => setCompany({ ...c })}
                >
                  <span className="row">
                    <b>{c.ticker}</b>
                    <b>{c.target}%</b>
                  </span>
                  <small>
                    {c.approved ? 'Eligible under saved screen' : 'Paused'} ·{' '}
                    {c.sector || 'No sector'} ·{' '}
                    {c.screenDate || 'No screen date'}
                  </small>
                  <p>{c.note}</p>
                  <span>Edit target & screening →</span>
                </button>
              ))}
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div className="section-top">
            <div>
              <h2>Transaction line items</h2>
              <p>
                Each purchase is saved as its own dated entry. Viewing a company
                shows every trade: date, shares, and price.
              </p>
            </div>
            <div className="row">
              <label className="history-filter">
                Company
                <select
                  value={historyTicker}
                  onChange={(e) => setHistoryTicker(e.target.value)}
                >
                  <option value="">All companies</option>
                  {p.companies.map((c) => (
                    <option key={c.ticker} value={c.ticker}>
                      {c.ticker} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {historyGroups.length === 0 ? (
            <section className="panel">
              <p className="muted">
                {historyTicker
                  ? `No transactions recorded for ${historyTicker} yet.`
                  : 'No transactions recorded yet.'}
              </p>
            </section>
          ) : (
            historyGroups.map(([ticker, rows]) => {
              const name =
                p.companies.find((c) => c.ticker === ticker)?.name ?? ticker;
              const live = rows.filter((t) => !t.voided);
              const purchases = live.filter((t) => t.kind === 'buy').length;
              return (
                <section
                  className="panel table-panel ledger-group"
                  key={ticker}
                >
                  <div className="ledger-heading">
                    <div>
                      <h3>
                        {ticker}
                        <small>{name}</small>
                      </h3>
                      <p>
                        {live.length} line item{live.length === 1 ? '' : 's'}
                        {purchases
                          ? ` · ${purchases} purchase${purchases === 1 ? '' : 's'}`
                          : ''}
                      </p>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditing(null);
                        setTrade(blankTrade(ticker));
                      }}
                    >
                      <Plus size={14} /> Add purchase
                    </button>
                  </div>
                  <TradeHistoryTable trades={rows} onCorrect={correctTrade} />
                </section>
              );
            })
          )}
        </TabsContent>
        <TabsContent value="research-desk">
          <ResearchDesk portfolio={p} onSave={save} />
        </TabsContent>
        <TabsContent value="research">
          <AiReview
            portfolio={p}
            revision={revision}
            month={month}
            busy={busy}
            reviewBusy={reviewBusy}
            setReviewBusy={setReviewBusy}
            proposal={proposal}
            setProposal={setProposal}
            onSave={save}
            onApplied={() => setTab('sip')}
          />
        </TabsContent>
      </Tabs>
      <footer>
        <div className="row">
          <span>All amounts in PKR · Private saved ledger</span>
          <button
            className="secondary compact"
            onClick={() =>
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
              )
            }
          >
            <Download size={14} /> Export backup
          </button>
          <label className="import-label">
            Restore backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
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
                  if (
                    !window.confirm(
                      'Replace this portfolio with the selected backup? Export your current backup first.',
                    )
                  )
                    return;
                  await save(data.portfolio, 'Portfolio backup restored.');
                });
                e.target.value = '';
              }}
            />
          </label>
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
                    className={trade.kind === 'buy' ? 'compact' : 'secondary compact'}
                    onClick={() => setTrade({ ...trade, kind: 'buy', month: today().slice(0, 7) })}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className={trade.kind === 'sell' ? 'compact' : 'secondary compact'}
                    onClick={() =>
                      setTrade({
                        ...trade,
                        kind: 'sell',
                        month: '',
                        price: trade.price ?? p.quotes[trade.ticker]?.price ?? null,
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
        open={!!company}
        onOpenChange={(open) => {
          if (!open) setCompany(null);
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
                    readOnly={
                      p.companies.some((c) => c.ticker === company.ticker) &&
                      company.name !== ''
                    }
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
                        sector: e.target.value as Sector | '',
                      })
                    }
                  >
                    <option value="" disabled>
                      Select sector
                    </option>
                    {SECTORS.map((sector) => (
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
  );
}
