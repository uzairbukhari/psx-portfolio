'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { money, today, type Portfolio } from '@/lib/portfolio';
import {
  estimateMonthlyPicks,
  type MonthlyPicksResearch,
} from '@/lib/monthly-picks';

type Recommendation = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  result: MonthlyPicksResearch | null;
  sources: { url: string; title: string }[];
  error: string | null;
  model: string;
  estimatedCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  portfolio: Portfolio;
  month: string;
  setMonth: (month: string) => void;
  feePct: number;
  setFeePct: (fee: number) => void;
  busy: boolean;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
  onRefreshPrices: () => Promise<void>;
  onManualPrice: (ticker: string) => void;
};

export default function MonthlyPicks({
  portfolio,
  month,
  setMonth,
  feePct,
  setFeePct,
  busy,
  onSave,
  onRefreshPrices,
  onManualPrice,
}: Props) {
  const initial = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies.filter((company) => company.target > 0).map((company) => company.ticker);
  const [shortlist, setShortlist] = useState<string[]>(initial.slice(0, 15));
  const [amount, setAmount] = useState(portfolio.budgets[month] ?? 100000);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<Recommendation[]>([]);
  const [current, setCurrent] = useState<Recommendation | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return portfolio.companies.filter(
      (company) =>
        !needle ||
        company.ticker.toLowerCase().includes(needle) ||
        company.name.toLowerCase().includes(needle),
    );
  }, [portfolio.companies, query]);

  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/recommendations');
    const data = (await response.json()) as {
      recommendations?: Recommendation[];
      error?: string;
    };
    if (!response.ok) throw Error(data.error);
    const rows = data.recommendations ?? [];
    setHistory(rows);
    setCurrent((value) => value ?? rows[0] ?? null);
    const running = rows.find((row) => ['queued', 'in_progress'].includes(row.status));
    if (running) setActiveId(running.id);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory().catch((error) => {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : String(error));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/recommendations?id=${encodeURIComponent(activeId)}`);
        const data = (await response.json()) as Recommendation & { error?: string };
        if (!response.ok) throw Error(data.error);
        if (cancelled) return;
        setCurrent(data);
        if (data.status === 'completed' || data.status === 'failed') {
          setActiveId(null);
          setFailed(data.status === 'failed');
          setMessage(
            data.status === 'completed'
              ? `Research ready · estimated API cost $${(data.estimatedCostUsd ?? 0).toFixed(4)}.`
              : data.error ?? 'Research did not complete.',
          );
          await loadHistory();
        }
      } catch (error) {
        if (!cancelled) {
          setActiveId(null);
          setFailed(true);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId, loadHistory]);

  function toggle(ticker: string) {
    setShortlist((selected) =>
      selected.includes(ticker)
        ? selected.filter((item) => item !== ticker)
        : selected.length < 15
          ? [...selected, ticker]
          : selected,
    );
  }

  async function runResearch() {
    setFailed(false);
    setMessage('');
    if (!shortlist.length) {
      setFailed(true);
      setMessage('Choose at least one company.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
      setFailed(true);
      setMessage('Enter a valid fresh investment amount.');
      return;
    }
    const shortlistChanged =
      JSON.stringify(portfolio.monthlyPicksShortlist ?? []) !== JSON.stringify(shortlist);
    const amountChanged = portfolio.budgets[month] !== amount;
    if (shortlistChanged || amountChanged) {
      await onSave(
        {
          ...portfolio,
          monthlyPicksShortlist: shortlist,
          budgets: { ...portfolio.budgets, [month]: amount },
        },
        'Monthly Picks inputs saved.',
      );
    }
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        amount,
        feePct,
        shortlist,
        rerun: currentMatches,
      }),
    });
    const data = (await response.json()) as Recommendation & { error?: string };
    if (!response.ok) throw Error(data.error);
    setCurrent(data);
    if (data.status === 'completed') {
      setMessage('Saved recommendation loaded · no new API charge.');
      await loadHistory();
    } else {
      setMessage('Research started. You can leave this page and return later.');
      setActiveId(data.id);
    }
  }

  const estimates = current?.result
    ? estimateMonthlyPicks(current.result, portfolio, current.amount, current.feePct)
    : [];
  const allocated = estimates.reduce((sum, pick) => sum + pick.allocationPkr, 0);
  const currentMatches =
    current?.status === 'completed' &&
    current.month === month &&
    current.amount === amount &&
    current.feePct === feePct &&
    JSON.stringify(current.shortlist) === JSON.stringify(shortlist);

  return (
    <div className="monthly-picks">
      <section className="panel picks-hero">
        <div>
          <p className="eyebrow">MONTHLY PICKS</p>
          <h2>Research your shortlist for the next 60–90 days.</h2>
          <p>
            Select companies, enter fresh money, and receive a sourced recommendation.
            Your holdings, target weights, and Research Desk are not used.
          </p>
        </div>
        <div className="picks-inputs">
          <label>
            Contribution month
            <input
              type="month"
              value={month}
              onChange={(event) => {
                const next = event.target.value || today().slice(0, 7);
                setMonth(next);
                setAmount(portfolio.budgets[next] ?? 100000);
              }}
            />
          </label>
          <label>
            Fresh investment (PKR)
            <input
              type="number"
              min="1"
              max="1000000000"
              step="1"
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
          </label>
          <label>
            Estimated fees (%)
            <input
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={feePct}
              onChange={(event) => setFeePct(Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="panel picks-shortlist">
        <div className="section-top">
          <div>
            <h2>Your shortlist</h2>
            <p>{shortlist.length}/15 selected · your selection is treated as eligible.</p>
          </div>
          <label className="picks-search">
            <Search size={16} />
            <input
              aria-label="Search companies"
              placeholder="Search name or ticker"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="company-picker">
          {filtered.map((company) => {
            const selected = shortlist.includes(company.ticker);
            return (
              <label key={company.ticker} className={selected ? 'company-option selected' : 'company-option'}>
                <Checkbox checked={selected} onCheckedChange={() => toggle(company.ticker)} />
                <span>
                  <b>{company.ticker}</b>
                  <small>{company.name}</small>
                </span>
                {selected && <Check size={15} />}
              </label>
            );
          })}
        </div>
        {!filtered.length && <p className="muted">No company matches that search.</p>}
        <div className="row picks-actions">
          <button
            disabled={busy || !!activeId || !shortlist.length}
            onClick={() =>
              void runResearch().catch((error) => {
                setFailed(true);
                setMessage(error instanceof Error ? error.message : String(error));
              })
            }
          >
            {activeId ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            {activeId
              ? 'Researching…'
              : currentMatches
                ? 'Research again'
                : 'Give me recommendation'}
          </button>
          <span className="muted">Maximum API cost: $1 per new run.</span>
        </div>
        {message && <div className={`notice ${failed ? 'error' : 'success'}`}>{message}</div>}
      </section>

      {current?.status === 'completed' && current.result && (
        <>
          <section className="panel picks-summary">
            <div className="section-top">
              <div>
                <p className="eyebrow">{current.month} RECOMMENDATION</p>
                <h2>{money(allocated)} allocated across {estimates.length} picks</h2>
              </div>
              <div className="row">
                <button className="secondary compact" onClick={() => void onRefreshPrices()}>
                  <RefreshCw size={15} /> Refresh prices
                </button>
                <span className="tag">{new Date(current.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <p>{current.result.marketOutlook}</p>
            <div className="split-stats picks-stats">
              <div><small>Fresh money</small><strong>{money(current.amount)}</strong></div>
              <div><small>Held as cash</small><strong>{money((current.amount * current.result.unallocatedPct) / 100)}</strong></div>
              <div><small>API cost</small><strong>${(current.estimatedCostUsd ?? 0).toFixed(4)}</strong></div>
            </div>
          </section>

          <div className="pick-cards">
            {estimates.map((pick, index) => (
              <article className="panel pick-card" key={pick.ticker}>
                <div className="pick-rank">#{index + 1}</div>
                <div className="section-top">
                  <div>
                    <h2>{pick.ticker} <small>{pick.name}</small></h2>
                    <span className="tag">{pick.confidence} confidence</span>
                  </div>
                  <div className="pick-allocation">
                    <strong>{money(pick.allocationPkr)}</strong>
                    <small>{pick.allocationPct}% allocation</small>
                  </div>
                </div>
                <p>{pick.thesis}</p>
                <div className="pick-reasons">
                  <div><b>Catalysts</b><ul>{pick.catalysts.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><b>Risks</b><ul>{pick.risks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                </div>
                <div className="pick-quantity">
                  {pick.shares === null ? (
                    <>
                      <span>Current dated price needed for share estimate.</span>
                      <button className="secondary compact" onClick={() => onManualPrice(pick.ticker)}>
                        Enter dated price
                      </button>
                    </>
                  ) : (
                    <>
                      <span><b>{pick.shares.toLocaleString()}</b> estimated whole shares</span>
                      <span>{money(pick.price)} · {pick.priceDate}</span>
                      <span>Estimated spend {money(pick.estimatedSpend)} including {current.feePct}% fees</span>
                    </>
                  )}
                </div>
                <div className="source-links">
                  {pick.sourceUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      Source <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <section className="panel picks-coverage">
            <h2>Every shortlisted company</h2>
            <p className="muted">Why each company was selected or left out.</p>
            {current.result.coverage.map((company) => (
              <details key={company.ticker}>
                <summary>
                  <b>{company.ticker}</b>
                  <span className="tag">{company.outlook}</span>
                </summary>
                <p>{company.summary}</p>
                <div className="source-links">
                  {company.sourceUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      Source <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </>
      )}

      {!!history.length && (
        <section className="panel picks-history">
          <h2>Previous recommendations</h2>
          <div className="history-pills">
            {history.map((item) => (
              <button key={item.id} className="secondary compact" onClick={() => setCurrent(item)}>
                {item.month} · {money(item.amount)} · {item.status}
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="table-note">
        Research is an evidence-based estimate, not a promise of returns or an order to trade.
        Review the sources and record actual purchases separately.
      </p>
    </div>
  );
}
