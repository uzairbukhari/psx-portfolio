'use client';
import { useEffect, useState } from 'react';
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
  ArrowUpRight,
  RefreshCw,
  Plus,
  Download,
  Sparkles,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import {
  holdings,
  plan,
  money,
  today,
  round,
  validate,
  reviewPrompt,
  validateReview,
  type Portfolio,
  type Trade,
  type Company,
} from '@/lib/portfolio';
import ResearchDesk from './research-desk';
type ApiResponse = {
  error?: string;
  portfolio: Portfolio;
  revision: number;
  available?: boolean;
  cached?: boolean;
  estimatedCostUsd?: number;
  quotes: Portfolio['quotes'];
  errors: string[];
  summary?: string;
  weights?: Record<string, number>;
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
const blankTrade = (): Trade => ({
  id: crypto.randomUUID(),
  ticker: 'MEBL',
  kind: 'buy',
  date: today(),
  shares: 1,
  price: null,
  fees: 0,
  month: today().slice(0, 7),
  note: '',
});
export default function Dashboard() {
  const [p, setP] = useState<Portfolio | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [tab, setTab] = useState('holdings'),
    [month, setMonth] = useState(today().slice(0, 7)),
    [fees, setFees] = useState(0),
    [allowOld, setAllowOld] = useState(false);
  const [trade, setTrade] = useState<Trade | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [company, setCompany] = useState<Company | null>(null),
    [quoteTicker, setQuoteTicker] = useState(''),
    [quotePrice, setQuotePrice] = useState(''),
    [quoteDate, setQuoteDate] = useState(today()),
    [aiText, setAiText] = useState(''),
    [proposal, setProposal] = useState<{
      summary: string;
      weights: Record<string, number>;
    } | null>(null),
    [reviewBusy, setReviewBusy] = useState(false),
    [promptOpen, setPromptOpen] = useState(false),
    [aiAvailable, setAiAvailable] = useState(false);
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
    fetch('/api/review')
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => setAiAvailable(!!d.available))
      .catch(() => {});
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
  if (!p)
    return (
      <main className="desk">
        <header>
          <div className="brand">
            P<span>PSX / PERSONAL INVESTING</span>
          </div>
          <span className="badge">PRIVATE WORKSPACE</span>
        </header>
        <section className="heading">
          <div>
            <p className="eyebrow">YOUR LONG-TERM PICTURE</p>
            <h1>Portfolio & SIP desk</h1>
            <p>
              {busy
                ? 'Loading your holdings and purchase history…'
                : 'Sign in to open your private investment workspace.'}
            </p>
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Sign in with ChatGPT →
            </a>
            {message && (
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
  const hs = holdings(p),
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
  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: p!.companies.map((c) => c.ticker) }),
      });
      const d = (await r.json()) as ApiResponse;
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
        `${Object.keys(d.quotes).length} PSX prices refreshed.${d.errors.length ? ' Unavailable: ' + d.errors.join(', ') + '. Previous quotes retained.' : ''}`,
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
        : 'Transaction saved. Holdings and average cost updated.',
    );
    setTrade(null);
    setEditing(null);
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
  async function aiReview() {
    setReviewBusy(true);
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, revision }),
      });
      const d = (await r.json()) as ApiResponse;
      if (!r.ok) throw Error(d.error);
      if (d.revision !== revision)
        throw Error('Portfolio changed. Run the review again.');
      setProposal(validateReview(d, p!));
      notify(
        d.cached
          ? 'Saved review reused · no new API charge.'
          : `AI review ready · estimated API cost $${(d.estimatedCostUsd ?? 0).toFixed(6)}. Inspect the reasoning before applying targets.`,
      );
    } catch (e) {
      notify(String(e), true);
    } finally {
      setReviewBusy(false);
    }
  }
  return (
    <main className="desk">
      <header>
        <div className="brand">
          <Wallet size={29} />
          <span>PSX / PERSONAL INVESTING</span>
        </div>
        <span className="badge">
          <ShieldCheck size={14} /> PRIVATE WORKSPACE
        </span>
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
              setTrade(blankTrade());
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
                gain === null ? 'inherit' : gain >= 0 ? '#17744c' : '#b33d3d',
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
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="sip">Monthly SIP</TabsTrigger>
          <TabsTrigger value="history">Purchase log</TabsTrigger>
          <TabsTrigger value="research-desk">Research desk</TabsTrigger>
          <TabsTrigger value="research">AI review</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings">
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
                      <div className="ticker">{h.ticker}</div>
                      <small>{h.name}</small>
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
                    <TableCell>
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
                      <button
                        className="secondary compact"
                        onClick={() =>
                          setCompany({
                            ...p.companies.find((c) => c.ticker === h.ticker)!,
                          })
                        }
                      >
                        Edit
                      </button>
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
              <h2>Every purchase, in one place</h2>
              <p>
                Opening balances are snapshots, not invented purchase history.
                Corrections retain the original entry.
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setEditing(null);
                setTrade({ ...blankTrade(), kind: 'sell', month: '' });
              }}
            >
              Record a sale
            </button>
          </div>
          <section className="panel table-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Date',
                    'Company',
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
                {[...p.trades]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((t) => (
                    <TableRow
                      key={t.id}
                      style={{ opacity: t.voided ? 0.5 : 1 }}
                    >
                      <TableCell>{t.date}</TableCell>
                      <TableCell className="ticker">
                        {t.ticker}
                        <small>{t.note}</small>
                      </TableCell>
                      <TableCell>
                        {t.voided ? 'Voided · ' : ''}
                        {t.kind}
                      </TableCell>
                      <TableCell>{t.shares.toLocaleString()}</TableCell>
                      <TableCell>{money(t.price)}</TableCell>
                      <TableCell>{money(t.fees)}</TableCell>
                      <TableCell>
                        {t.price === null
                          ? 'Unknown'
                          : money(
                              t.shares * t.price +
                                (t.kind === 'sell' ? -t.fees : t.fees),
                            )}
                      </TableCell>
                      <TableCell>{t.month || '—'}</TableCell>
                      <TableCell>
                        {!t.voided && (
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditing(t.id);
                              setTrade({ ...t });
                            }}
                          >
                            Correct
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </section>
        </TabsContent>
        <TabsContent value="research-desk">
          <ResearchDesk portfolio={p} onSave={save} />
        </TabsContent>
        <TabsContent value="research">
          <div className="two-col">
            <section className="panel">
              <p className="eyebrow">LOW-COST MODE · GPT-5 NANO</p>
              <h2>A useful second look. At a tiny cost.</h2>
              <p>
                Review concentration, current holdings, your {money(budget)}{' '}
                budget, quote dates, and the seven-company research shortlist.
                AI uses a compact summary and saved research to propose target
                weights. Calculations run without AI charges. Unchanged reviews
                are reused.
              </p>
              <div className="row">
                <button
                  disabled={reviewBusy || busy || !aiAvailable}
                  onClick={aiReview}
                >
                  <Sparkles size={16} />
                  {reviewBusy ? 'Reviewing portfolio…' : 'Generate AI review'}
                </button>
                <button
                  className="secondary"
                  onClick={() => setPromptOpen(true)}
                >
                  Export to ChatGPT
                </button>
              </div>
              {!aiAvailable && (
                <p className="notice">
                  Built-in AI is awaiting a secure connection. The ChatGPT
                  handoff below works now.
                </p>
              )}
              <p className="muted">
                No paid web searches or automatic retries. This review uses
                saved research; it does not verify new filings or current
                Shariah status. No orders are placed.
              </p>
            </section>
            <aside className="panel accent">
              <p className="eyebrow">RESEARCH STATUS · 10 SEP 2026</p>
              <h2>Evidence before allocation.</h2>
              <p>
                MEBL has a full dossier. The other six companies remain a
                provisional shortlist. SYS is paused pending a
                consolidated-results check. FFC needs care around its Shariah
                screening threshold.
              </p>
              <p>
                LPL is excluded from new contributions under the saved June 2026
                screening result.
              </p>
              <a
                href="https://www.psx.com.pk/psx/files/?file=277899-1.pdf"
                target="_blank"
                rel="noreferrer"
              >
                View prior PSX screening notice ↗
              </a>
            </aside>
          </div>
          <section className="panel" style={{ marginTop: 24 }}>
            <h2>Bring back a ChatGPT review</h2>
            <p>
              Export the review prompt, use it in your research conversation,
              then paste its JSON here. Review the proposed changes before
              applying them.
            </p>
            <label>
              AI review JSON
              <textarea
                rows={5}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={
                  '{"summary":"Reasoning with sources and research gaps…","weights":{"MEBL":15,…}}'
                }
              />
            </label>
            <button
              className="secondary"
              onClick={() => {
                try {
                  setProposal(validateReview(JSON.parse(aiText), p));
                  notify(
                    'Review validated. Inspect the proposed weights below.',
                  );
                } catch (e) {
                  notify(String(e), true);
                }
              }}
            >
              Validate & preview
            </button>
          </section>
          {proposal && (
            <section className="panel" style={{ marginTop: 24 }}>
              <p className="eyebrow">PROPOSED TARGETS · NOT APPLIED</p>
              <h2>Review the reasoning</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{proposal.summary}</p>
              <div className="target-grid">
                {Object.entries(proposal.weights).map(([t, w]) => (
                  <div key={t} className="mini-stat">
                    <span>{t}</span>
                    <b>
                      {p.companies.find((c) => c.ticker === t)?.target}% → {w}%
                    </b>
                  </div>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  attempt(async () => {
                    const next = clone(p);
                    next.companies = next.companies.map((c) => ({
                      ...c,
                      target: proposal.weights[c.ticker] ?? c.target,
                    }));
                    next.aiReview = {
                      ...proposal,
                      generatedAt: new Date().toISOString(),
                      snapshot: JSON.stringify({ revision, month }),
                    };
                    await save(
                      next,
                      'Reviewed AI targets applied. Purchase eligibility remains your decision.',
                    );
                    setTab('sip');
                  })
                }
              >
                Apply reviewed targets
              </button>
            </section>
          )}
          {p.aiReview && (
            <section className="panel" style={{ marginTop: 24 }}>
              <h2>Last applied AI review</h2>
              <small>{p.aiReview.generatedAt}</small>
              <p style={{ whiteSpace: 'pre-wrap' }}>{p.aiReview.summary}</p>
            </section>
          )}
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
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="form-dialog">
          <DialogTitle>Review in ChatGPT</DialogTitle>
          <DialogDescription>
            This contains your holdings and transactions. Copy it into your
            private research conversation.
          </DialogDescription>
          <textarea
            aria-label="Portfolio review prompt"
            readOnly
            rows={12}
            value={reviewPrompt(p, month)}
          />
          <div className="row">
            <button
              onClick={() =>
                attempt(async () => {
                  await navigator.clipboard.writeText(reviewPrompt(p, month));
                  notify(
                    'Review prompt copied. Paste it into your research conversation.',
                  );
                })
              }
            >
              Copy review prompt
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(
                  `psx-ai-review-${today()}.txt`,
                  reviewPrompt(p, month),
                  'text/plain',
                )
              }
            >
              Download prompt
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
