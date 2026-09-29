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
  // 'completed_partial' / 'needs_evidence' / 'needs_attention' are only reachable on
  // rows saved by the earlier per-company-evidence workflow; every run made under the
  // current workflow settles into either 'completed' (AI-ranked or quant fallback) or
  // 'failed' (PSX had no usable data for any shortlisted company).
  status: 'queued' | 'in_progress' | 'completed' | 'completed_partial' | 'failed' | 'needs_evidence' | 'needs_attention';
  result: MonthlyPicksResearch | null;
  sources: { url: string; title: string }[];
  error: string | null;
  model: string;
  estimatedCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
  phase?: string;
  workflowVersion?: number;
  budgetCommittedUsd?: number;
  method?: 'ai' | 'quant';
  dataAsOf?: string;
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

const secondarySource = (url: string, sourceType?: string) => sourceType === 'secondary' ||
  /(?:ksealert|marketscreener|visapathway|financialfilings|finhisaab|investegate|psxterminal|brecorder|dawn|profit\.pakistantoday|mettisglobal|tribune)\./i.test(new URL(url).hostname);

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
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/recommendations?id=${encodeURIComponent(activeId)}`);
        const data = (await response.json()) as Recommendation & { error?: string };
        if (!response.ok) throw Error(data.error);
        if (cancelled) return;
        setCurrent(data);
        if (!['queued', 'in_progress'].includes(data.status)) {
          setActiveId(null);
          setFailed(data.status === 'failed');
          setMessage(
            data.status === 'completed'
              ? `Research ready · estimated API cost $${(data.estimatedCostUsd ?? 0).toFixed(4)}.`
              : data.error ?? 'Research needs attention; your draft is saved.',
          );
          await loadHistory();
        }
      } catch (error) {
        if (!cancelled) {
          setActiveId(null);
          setFailed(true);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally { polling = false; }
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
    } else if (['queued', 'in_progress'].includes(data.status)) {
      setMessage('Research started. You can leave this page and return later.');
      setActiveId(data.id);
    } else {
      setMessage(data.error ?? 'Saved draft loaded. Review the evidence gaps below.');
      await loadHistory();
    }
  }

  const estimates = current?.result
    ? estimateMonthlyPicks(
        // Rows saved by the very first workflow never recorded per-pick evidence
        // status; treat those as unverified rather than assume they're safe to size.
        (current.workflowVersion ?? 1) < 2
          ? { ...current.result, picks: current.result.picks.map((pick) => ({ ...pick, evidenceStatus: 'needs_repair' as const })) }
          : current.result,
        portfolio,
        current.amount,
        current.feePct,
      )
    : [];
  const allocated = estimates.reduce((sum, pick) => sum + pick.allocationPkr, 0);
  const currentMatches =
    current !== null &&
    ['completed', 'completed_partial'].includes(current.status) &&
    current.month === month &&
    current.amount === amount &&
    current.feePct === feePct &&
    JSON.stringify([...current.shortlist].sort()) === JSON.stringify([...shortlist].sort());

  return (
    <div className="monthly-picks">
      <section className="picks-plan">
        <div className="picks-plan__intro">
          <p className="eyebrow">MONTHLY PICKS</p>
          <h2>Research your shortlist for the next 60–90 days</h2>
          <p>Pick companies, enter fresh money, get a sourced recommendation. Holdings, target weights and Research Desk are not used.</p>
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
          <div className="picks-tools">
          {!!shortlist.length && (
            <button type="button" className="link-button" onClick={() => setShortlist([])}>
              Clear all
            </button>
          )}
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
        </div>
        <div className="company-picker">
          {filtered.map((company) => {
            const selected = shortlist.includes(company.ticker);
            return (
              <label key={company.ticker} className={selected ? 'company-option selected' : 'company-option'}>
                <Checkbox checked={selected} onCheckedChange={() => toggle(company.ticker)} />
                <span className="company-option__text">
                  <b>{company.ticker}</b>
                  <small title={company.name}>{company.name}</small>
                </span>
                {selected && <Check size={15} className="company-option__check" />}
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
              ? 'Ranking…'
              : currentMatches
                ? 'Research again'
                : 'Give me recommendation'}
          </button>
          <span className="muted">Priced from PSX company data; a small AI call ranks the shortlist (≈$0.01–0.02).</span>
        </div>
        {message && <div className={`notice ${failed ? 'error' : 'success'}`}>{message}</div>}
      </section>

      {current?.status === 'failed' && (
        <section className="panel" aria-live="polite">
          <h2>No recommendation for this run</h2>
          <p>{current.error}</p>
        </section>
      )}

      {current && ['needs_evidence', 'needs_attention'].includes(current.status) && (
        <section className="panel" aria-live="polite">
          <h2>Older draft needs attention</h2>
          <p>This run was saved by an earlier version of Monthly Picks. Start a fresh run above for the current workflow.</p>
          <p>{current.error}</p>
          <ul>{current.result?.evidenceIssues?.map((issue, index) => typeof issue === 'string'
            ? <li key={`${index}:${String(issue)}`}>{issue}</li>
            : <li key={`${issue.ticker}:${issue.kind}`}><b>{issue.ticker}:</b> {issue.message}</li>)}</ul>
        </section>
      )}

      {current?.status === 'completed_partial' && current.result && (
        <section className="panel" aria-live="polite">
          <h2>Recommendation from the researched subset</h2>
          <p>Assessed {current.result.assessedCount ?? 0} of {current.result.totalCount ?? current.shortlist.length} companies. Unassessed candidates are listed below and were excluded from the ranking.</p>
        </section>
      )}

      {current?.result && (
        <>
          <section className="picks-summary">
            <div className="section-top">
              <div>
                <p className="eyebrow">{current.month} RECOMMENDATION</p>
                <h2>{['completed', 'completed_partial'].includes(current.status) ? 'Recommendation' : 'Provisional comparison'} · {estimates.length} picks</h2>
                <p className="muted">
                  {['completed', 'completed_partial'].includes(current.status) ? '' : 'Proposed; not ready for execution. '}
                  {current.workflowVersion === 2 && `Assessed ${current.result.assessedCount ?? 0} of ${current.result.totalCount ?? current.result.coverage.length}. `}
                  {current.method && (current.method === 'ai' ? 'AI-ranked' : 'Quantitative fallback')}
                  {current.dataAsOf && ` · PSX data as of ${current.dataAsOf}`}
                </p>
              </div>
              <div className="row">
                <button className="secondary compact" onClick={() => void onRefreshPrices()}>
                  <RefreshCw size={15} /> Refresh prices
                </button>
                <span className="tag">{new Date(current.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="picks-kpis">
              <div><span>Fresh money</span><b>{money(current.amount)}</b></div>
              <div><span>Allocated</span><b>{money(allocated)}</b></div>
              <div><span>Held as cash</span><b>{money((current.amount * current.result.unallocatedPct) / 100)}</b></div>
              <div><span>API cost</span><b>${(current.estimatedCostUsd ?? 0).toFixed(4)}</b></div>
            </div>
            {!!estimates.length && (
              <div className="picks-alloc" aria-hidden="true">
                {estimates.map((pick, index) => (
                  <i key={pick.ticker} className={`alloc-${index % 6}`} style={{ width: `${pick.allocationPct}%` }} title={`${pick.ticker} ${pick.allocationPct}%`} />
                ))}
              </div>
            )}
            <div className="picks-legend">
              {estimates.map((pick, index) => (
                <span key={pick.ticker}><i className={`alloc-${index % 6}`} />{pick.ticker} <b>{pick.allocationPct}%</b></span>
              ))}
            </div>
            <p className="picks-outlook">{current.result.marketOutlook}</p>
            {current.method === 'quant' && (
              <p className="muted">The AI ranking step was unavailable for this run; picks are ordered by the deterministic quant score.</p>
            )}
          </section>

          <div className="pick-cards">
            {estimates.map((pick, index) => (
              <article className="pick-card" key={pick.ticker}>
                <header className="pick-head">
                  <span className="pick-rank">{index + 1}</span>
                  <div className="pick-title">
                    <h3>{pick.ticker}</h3>
                    <small title={pick.name}>{pick.name}</small>
                  </div>
                  <span className="tag">{pick.confidence} confidence</span>
                  <div className="pick-allocation">
                    <strong>{money(pick.allocationPkr)}</strong>
                    <small>{pick.allocationPct}%</small>
                  </div>
                </header>
                {pick.metrics && (
                  <div className="pick-metrics">
                    <div><span>P/E (TTM)</span><b>{pick.metrics.peTtm ?? '—'}</b></div>
                    <div><span>EPS YoY</span><b>{pick.metrics.epsYoYPct === null ? '—' : `${pick.metrics.epsYoYPct}%`}</b></div>
                    <div><span>1Y change</span><b>{pick.metrics.change1yPct === null ? '—' : `${pick.metrics.change1yPct}%`}</b></div>
                    <div><span>Quant score</span><b>{pick.metrics.score ?? '—'}/100</b></div>
                  </div>
                )}
                <p className="pick-thesis">{pick.thesis}</p>
                <div className="pick-quantity">
                  {pick.shares === null ? (
                    <>
                      <span>{pick.evidenceStatus === 'needs_repair' ? 'Supporting evidence is incomplete.' : 'Current dated price needed for share estimate.'}</span>
                      <button className="secondary compact" onClick={() => onManualPrice(pick.ticker)}>
                        Enter dated price
                      </button>
                    </>
                  ) : (
                    <>
                      <span><b>{pick.shares.toLocaleString()}</b> whole shares</span>
                      <span>{money(pick.price)} · {pick.priceDate}</span>
                      <span>~{money(pick.estimatedSpend)} incl. {current.feePct}% fees</span>
                    </>
                  )}
                </div>
                <details className="pick-more">
                  <summary>Reasoning, risks and sources</summary>
                  {pick.whySelected && <p><b>Why selected:</b> {pick.whySelected}</p>}
                  {pick.invalidation && <p><b>What would invalidate this view:</b> {pick.invalidation}</p>}
                  <div className="pick-reasons">
                    <div><b>Catalysts</b><ul>{pick.catalysts.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    <div><b>Risks</b><ul>{pick.risks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  </div>
                  <div className="source-links">
                    {(pick.sourceDetails ?? pick.sourceUrls.map((url) => ({ url, title: 'Source', date: '', sourceType: undefined }))).map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        {secondarySource(source.url, source.sourceType) ? 'Secondary · ' : ''}{source.title}{source.date ? ` · ${source.date}` : ''} <ExternalLink size={13} />
                      </a>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </div>

          <section className="panel picks-coverage">
            <h2>Every shortlisted company</h2>
            <p className="muted">Investment outlook and evidence status are separate. A citation gap is not a negative outlook.</p>
            {(['Positive', 'Neutral', 'Negative', 'Insufficient evidence'] as const).map((outlook) => {
              const group = current.result!.coverage.filter((company) => company.outlook === outlook);
              if (!group.length) return null;
              return (
                <div className="cov-group" key={outlook}>
                  <h3 className={`cov-title outlook-${outlook.split(' ')[0].toLowerCase()}`}>
                    {outlook} <span>{group.length}</span>
                  </h3>
                  <div className="cov-grid">
                    {group.map((company) => (
                      <details key={company.ticker} className={`cov-card outlook-${company.outlook.split(" ")[0].toLowerCase()}`}>
                        <summary>
                          <b>{company.ticker}</b>
                          {company.assessmentStatus === 'unassessed' && <span className="tag">Unassessed</span>}
                          <small title={company.summary}>{company.summary}</small>
                        </summary>
                        <p>{company.summary}</p>
                        {company.metrics && (
                          <p className="muted">
                            P/E (TTM) {company.metrics.peTtm ?? '—'} · EPS YoY {company.metrics.epsYoYPct === null ? '—' : `${company.metrics.epsYoYPct}%`} ·
                            {' '}1Y change {company.metrics.change1yPct === null ? '—' : `${company.metrics.change1yPct}%`} · quant score {company.metrics.score ?? '—'}/100
                          </p>
                        )}
                        {company.evidenceGap && <p className="muted"><b>Evidence gap:</b> {company.evidenceGap}</p>}
                        {company.dataGaps?.map((gap) => <p key={gap} className="muted">{gap}</p>)}
                        <div className="source-links">
                          {(company.sourceDetails ?? company.sourceUrls.map((url) => ({ url, title: 'Source', date: '', sourceType: undefined }))).map((source) => (
                            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                              {secondarySource(source.url, source.sourceType) ? 'Secondary · ' : ''}{source.title}{source.date ? ` · ${source.date}` : ''} <ExternalLink size={13} />
                            </a>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              );
            })}
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
