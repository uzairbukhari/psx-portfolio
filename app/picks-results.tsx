'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import { money, type Portfolio } from '@/lib/portfolio';
import { estimateMonthlyPicks, type CompanyOutlook, type MonthlyPickEstimate } from '@/lib/monthly-picks';
import type { Recommendation } from './use-recommendations';

const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`);
const num = (value: number | null | undefined) => (value === null || value === undefined ? '—' : String(value));
const OUTLOOKS = ['Positive', 'Neutral', 'Negative', 'Insufficient evidence'] as const;
const outlookClass = (outlook: string) => outlook.split(' ')[0].toLowerCase();

function Sources({ items }: { items: { url: string; title: string; date?: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="source-links">
      {items.map((source) => (
        <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
          {source.title}{source.date ? ` · ${source.date}` : ''} <ExternalLink size={13} />
        </a>
      ))}
    </div>
  );
}
const sourceItems = (item: { sourceUrls: string[]; sourceDetails?: { url: string; title: string; date: string }[] }) =>
  item.sourceDetails ?? item.sourceUrls.map((url) => ({ url, title: 'Source', date: '' }));

type Props = {
  run: Recommendation;
  portfolio: Portfolio;
  onRefreshPrices: () => void;
  onManualPrice: (ticker: string) => void;
};

export default function PicksResults({ run, portfolio, onRefreshPrices, onManualPrice }: Props) {
  const result = run.result!;
  const legacy = (run.workflowVersion ?? 1) < 2;
  const estimates: MonthlyPickEstimate[] = useMemo(
    () => estimateMonthlyPicks(
      // Runs saved by the very first workflow never recorded per-pick evidence; don't size them.
      legacy ? { ...result, picks: result.picks.map((pick) => ({ ...pick, evidenceStatus: 'needs_repair' as const })) } : result,
      portfolio, run.amount, run.feePct,
    ),
    [legacy, result, portfolio, run.amount, run.feePct],
  );
  const allocated = estimates.reduce((sum, pick) => sum + pick.allocationPkr, 0);
  const names = useMemo(() => new Map(portfolio.companies.map((company) => [company.ticker, company.name])), [portfolio.companies]);

  const [filter, setFilter] = useState<(typeof OUTLOOKS)[number] | 'All'>('All');
  const [sort, setSort] = useState<'score' | 'ticker'>('score');
  const [open, setOpen] = useState<string | null>(null);
  const coverage = useMemo(() => {
    const rows = result.coverage.filter((company) => filter === 'All' || company.outlook === filter);
    return [...rows].sort((a, b) => sort === 'ticker' ? a.ticker.localeCompare(b.ticker) : (b.metrics?.score ?? -1) - (a.metrics?.score ?? -1));
  }, [result.coverage, filter, sort]);
  const counts = useMemo(() => Object.fromEntries(OUTLOOKS.map((outlook) => [outlook, result.coverage.filter((c) => c.outlook === outlook).length])), [result.coverage]);

  return (
    <>
      <section className="mp-summary">
        <div className="mp-summary__top">
          <div>
            <p className="eyebrow">{run.month} RECOMMENDATION</p>
            <h2>{estimates.length ? `${estimates.length} ${estimates.length === 1 ? 'pick' : 'picks'} for ${money(run.amount)}` : 'No pick this month'}</h2>
            <p className="mp-summary__meta">
              <span className={`mp-badge mp-badge--${run.method === 'quant' ? 'neutral' : 'primary'}`}>{run.method === 'quant' ? 'Quant ranking' : run.method === 'ai' ? 'AI-ranked' : 'Saved run'}</span>
              {run.dataAsOf && <span>PSX data as of {run.dataAsOf}</span>}
              <span>{new Date(run.createdAt).toLocaleDateString()}</span>
              {run.estimatedCostUsd !== null && <span>API ${run.estimatedCostUsd.toFixed(4)}</span>}
            </p>
          </div>
          <button type="button" className="secondary compact" onClick={onRefreshPrices}><RefreshCw size={14} /> Refresh prices</button>
        </div>
        <div className="mp-kpis">
          <div><span>Fresh money</span><b>{money(run.amount)}</b></div>
          <div><span>Allocated</span><b>{money(allocated)}</b></div>
          <div><span>Held as cash</span><b>{money((run.amount * result.unallocatedPct) / 100)}</b></div>
          <div><span>Companies scored</span><b>{result.assessedCount ?? result.coverage.length}/{result.totalCount ?? result.coverage.length}</b></div>
        </div>
        {!!estimates.length && (
          <>
            <div className="mp-alloc" aria-hidden="true">
              {estimates.map((pick, index) => <i key={pick.ticker} className={`alloc-${index % 6}`} style={{ width: `${pick.allocationPct}%` }} title={`${pick.ticker} ${pick.allocationPct}%`} />)}
            </div>
            <div className="mp-legend">
              {estimates.map((pick, index) => <span key={pick.ticker}><i className={`alloc-${index % 6}`} />{pick.ticker} <b>{pick.allocationPct}%</b></span>)}
              {result.unallocatedPct > 0 && <span><i className="alloc-cash" />Cash <b>{result.unallocatedPct}%</b></span>}
            </div>
          </>
        )}
        <p className="mp-outlook">{result.marketOutlook}</p>
      </section>

      <div className="mp-cards">
        {estimates.map((pick, index) => (
          <article className="mp-card" key={pick.ticker}>
            <header className="mp-card__head">
              <span className="mp-rank">{index + 1}</span>
              <div className="mp-card__title">
                <h3><a href={`/company/${pick.ticker}`}>{pick.ticker}</a></h3>
                <small title={pick.name}>{pick.name}</small>
              </div>
              <span className={`mp-badge mp-badge--${pick.confidence.toLowerCase()}`}>{pick.confidence}</span>
              <div className="mp-card__alloc"><strong>{money(pick.allocationPkr)}</strong><small>{pick.allocationPct}%</small></div>
            </header>
            {pick.metrics && (
              <div className="mp-metrics">
                <div><span>P/E (TTM)</span><b>{num(pick.metrics.peTtm)}</b></div>
                <div><span>EPS YoY</span><b>{pct(pick.metrics.epsYoYPct)}</b></div>
                <div><span>1Y change</span><b>{pct(pick.metrics.change1yPct)}</b></div>
                <div><span>Score</span><b>{pick.metrics.score === null ? '—' : `${pick.metrics.score}/100`}</b></div>
              </div>
            )}
            <p className="mp-thesis">{pick.thesis}</p>
            <div className="mp-quantity">
              {pick.shares === null ? (
                <>
                  <span>{pick.evidenceStatus === 'needs_repair' ? 'Supporting evidence is incomplete.' : 'A dated price from the last 7 days is needed for a share estimate.'}</span>
                  <button type="button" className="secondary compact" onClick={() => onManualPrice(pick.ticker)}>Enter price</button>
                </>
              ) : (
                <>
                  <span><b>{pick.shares.toLocaleString()}</b> whole shares</span>
                  <span>{money(pick.price)} · {pick.priceDate}</span>
                  <span>≈ {money(pick.estimatedSpend)} incl. {run.feePct}% fees</span>
                </>
              )}
            </div>
            <details className="mp-more">
              <summary>Reasoning, risks and sources</summary>
              {pick.whySelected && <p><b>Why selected:</b> {pick.whySelected}</p>}
              {pick.invalidation && <p><b>What would change this view:</b> {pick.invalidation}</p>}
              <div className="mp-reasons">
                <div><b>Catalysts</b><ul>{pick.catalysts.length ? pick.catalysts.map((item) => <li key={item}>{item}</li>) : <li>None on file</li>}</ul></div>
                <div><b>Risks</b><ul>{pick.risks.length ? pick.risks.map((item) => <li key={item}>{item}</li>) : <li>None listed</li>}</ul></div>
              </div>
              <Sources items={sourceItems(pick)} />
            </details>
          </article>
        ))}
      </div>

      <section className="mp-coverage">
        <div className="mp-coverage__top">
          <div>
            <h3>Every shortlisted company</h3>
            <p className="muted">Outlook and data quality are separate: a data gap is not a negative view.</p>
          </div>
          <label className="mp-sort">
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as 'score' | 'ticker')}>
              <option value="score">Score</option>
              <option value="ticker">Ticker</option>
            </select>
          </label>
        </div>
        <div className="mp-chips">
          {(['All', ...OUTLOOKS] as const).map((option) => {
            const count = option === 'All' ? result.coverage.length : counts[option];
            if (option !== 'All' && !count) return null;
            return (
              <button key={option} type="button" className={`mp-chip${filter === option ? ' active' : ''}`} aria-pressed={filter === option} onClick={() => setFilter(option)}>
                {option} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="mp-table-wrap">
          <table className="mp-table">
            <thead>
              <tr><th>Company</th><th>Outlook</th><th>Score</th><th>P/E</th><th>EPS YoY</th><th>1Y</th><th aria-label="Details" /></tr>
            </thead>
            <tbody>
              {coverage.map((company: CompanyOutlook) => {
                const isOpen = open === company.ticker;
                const gaps = company.dataGaps?.length ?? 0;
                return (
                  <Fragment key={company.ticker}>
                    <tr className={isOpen ? 'open' : undefined}>
                      <td>
                        <a href={`/company/${company.ticker}`}><b>{company.ticker}</b></a>
                        <small title={names.get(company.ticker)}>{names.get(company.ticker) ?? ''}</small>
                      </td>
                      <td><span className={`mp-badge mp-badge--${outlookClass(company.outlook)}`}>{company.outlook === 'Insufficient evidence' ? 'No data' : company.outlook}</span></td>
                      <td>
                        {company.metrics?.score != null && company.assessmentStatus !== 'unassessed'
                          ? <span className="mp-score"><span className="mp-score__bar"><i style={{ width: `${company.metrics.score}%` }} /></span>{company.metrics.score}</span>
                          : '—'}
                      </td>
                      <td>{num(company.metrics?.peTtm)}</td>
                      <td>{pct(company.metrics?.epsYoYPct)}</td>
                      <td>{pct(company.metrics?.change1yPct)}</td>
                      <td>
                        <button type="button" className="mp-expand" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${company.ticker} details`} onClick={() => setOpen(isOpen ? null : company.ticker)}>
                          {gaps > 0 && <span className="mp-gaps" title={`${gaps} data gap${gaps === 1 ? '' : 's'}`}>{gaps}</span>}
                          <ChevronDown size={16} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="mp-detail">
                        <td colSpan={7}>
                          <p>{company.summary}</p>
                          {company.dataGaps?.map((gap) => <p key={gap} className="muted">• {gap}</p>)}
                          <Sources items={sourceItems(company)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!coverage.length && <p className="muted mp-empty">No companies in this group.</p>}
        </div>
      </section>
    </>
  );
}
