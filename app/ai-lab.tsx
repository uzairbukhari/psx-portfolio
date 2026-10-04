'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, FlaskConical, Loader2, Microscope } from 'lucide-react';
import { holdings, money, today, type Portfolio } from '@/lib/portfolio';
import { buildAiLabResult, estimateAiLabBuys, recordAiLabRun } from '@/lib/ai-lab-picks';
import { summarizeEstimates } from '@/lib/monthly-picks';
import { explainSizing } from '@/lib/monthly-picks-allocation';
import { MAX_WATCH_TICKERS } from '@/lib/market-watch';
import type { AiLabRun } from '@/lib/ai-lab-types';
import AiLabHoldings from './ai-lab-holdings';
import { TabLoader } from './tab-loader';
import { STATE_LABEL, useAiLabResearch } from './use-ai-lab';

const MAX_SHORTLIST = 15;
type Section = 'picks' | 'holdings' | 'log';
const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

type Props = {
  portfolio: Portfolio;
  busy: boolean;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
  onOpenCompany: (ticker: string) => void;
};

export default function AiLab({ portfolio, busy, onSave, onOpenCompany }: Props) {
  const [section, setSection] = useState<Section>('picks');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [amount, setAmount] = useState(portfolio.budgets[month] ?? 100000);
  const [feePct, setFeePct] = useState(0.5);
  const initial = portfolio.monthlyPicksShortlist?.length ? portfolio.monthlyPicksShortlist : portfolio.companies.filter((c) => c.target > 0).map((c) => c.ticker);
  const [shortlist, setShortlist] = useState<string[]>(initial.slice(0, MAX_SHORTLIST));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Companies the user ticked for research. Nothing is researched (or paid for) unless it is ticked here.
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const positions = useMemo(() => holdings(portfolio).filter((h) => h.shares > 0), [portfolio]);
  // One ticker list is sent for both features, so the server cannot tell the shortlist from what you hold.
  const researchTickers = useMemo(
    () => [...new Set([...shortlist, ...positions.map((h) => h.ticker)])].slice(0, MAX_WATCH_TICKERS),
    [shortlist, positions],
  );
  const heldSet = useMemo(() => new Set(positions.map((h) => h.ticker)), [positions]);
  const lab = useAiLabResearch(researchTickers);
  const names = useMemo(() => Object.fromEntries(portfolio.companies.map((c) => [c.ticker, c.name])), [portfolio.companies]);
  const runs = portfolio.aiLabRuns ?? [];
  const run = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;
  const monthlyRun = run ? portfolio.monthlyPicksRuns?.find((r) => r.month === run.month && r.status === 'completed' && r.result) : undefined;

  if (!lab.loaded) return <div className="ai-lab"><TabLoader label="Loading AI Lab…" /></div>;
  const enabled = lab.data?.enabled !== false;
  const needing = researchTickers.filter((t) => !['ready', 'carried', 'queued', 'researching'].includes(lab.stateOf(t)));
  const picked = chosen.filter((t) => researchTickers.includes(t) && !['queued', 'researching'].includes(lab.stateOf(t)));
  const toggleChosen = (ticker: string) => setChosen((list) => (list.includes(ticker) ? list.filter((t) => t !== ticker) : [...list, ticker]));
  async function researchPicked() {
    await lab.request(picked);
    setChosen((list) => list.filter((t) => !picked.includes(t)));
  }
  const overLimit = shortlist.length + positions.filter((h) => !shortlist.includes(h.ticker)).length > MAX_WATCH_TICKERS;

  async function generate() {
    if (!lab.data) return;
    setSaving(true);
    try {
      const quantScores: Record<string, number> = {};
      for (const c of monthlyRun?.result?.coverage ?? []) if (c.metrics?.score != null) quantScores[c.ticker] = c.metrics.score;
      const result = buildAiLabResult({
        shortlist, research: lab.data, names, quantScores, amount,
        holdings: positions.map((h) => ({ ticker: h.ticker, valuePkr: h.value })),
      });
      const next: AiLabRun = { id: crypto.randomUUID(), month, amount, feePct, shortlist: [...shortlist], createdAt: new Date().toISOString(), result };
      await onSave({ ...portfolio, aiLabRuns: recordAiLabRun(portfolio.aiLabRuns, next) }, 'AI Lab run saved.');
      setSelectedId(next.id);
    } catch (cause) {
      lab.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (ticker: string) =>
    setShortlist((list) => (list.includes(ticker) ? list.filter((t) => t !== ticker) : list.length < MAX_SHORTLIST ? [...list, ticker] : list));
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= 1e9;

  return (
    <div className="ai-lab">
      <section className="ai-lab__hero">
        <div>
          <p className="eyebrow"><FlaskConical size={14} aria-hidden="true" /> EXPERIMENTAL · SUPER ADMIN ONLY</p>
          <h2>AI Lab</h2>
          <p>
            AI research on your companies, with sources checked in code, for new money and for what you already hold.
            Monthly Picks is unchanged. The AI sees only public company data and tickers, never your amounts or holdings.
          </p>
        </div>
        {lab.data && (
          <div className="ai-lab__spend" title="AI spend this month against the cap">
            <small>AI spend, {lab.data.spend.month}</small>
            <b>${lab.data.spend.usd.toFixed(2)} <span>of ${lab.data.spend.capUsd.toFixed(2)}</span></b>
            <div className="bar"><i style={{ width: `${Math.min(100, (lab.data.spend.usd / lab.data.spend.capUsd) * 100)}%` }} /></div>
          </div>
        )}
      </section>

      {!enabled && <div className="notice" aria-live="polite">AI Lab research is switched off (AI_LAB_ENABLED=false). Stored research is hidden until it is switched back on.</div>}
      {lab.error && <div className="notice error" role="alert">{lab.error} <button type="button" className="link-button" onClick={() => lab.setError(null)}>Dismiss</button></div>}
      {lab.notice && <div className="notice" aria-live="polite">{lab.notice}</div>}

      <div className="ai-lab__tabs" role="tablist" aria-label="AI Lab sections">
        {([['picks', 'Picks'], ['holdings', 'Holdings review'], ['log', 'Research log']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={`secondary compact${section === id ? ' ai-lab__tab--on' : ''}`} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {section === 'picks' && (
        <>
          <section className="ai-lab__panel">
            <div className="ai-lab__fields">
              <label>Contribution month
                <input type="month" value={month} onChange={(e) => { const next = e.target.value || today().slice(0, 7); setMonth(next); setAmount(portfolio.budgets[next] ?? 100000); }} />
              </label>
              <label>Fresh money (PKR)
                <input type="number" inputMode="numeric" min="1" max="1000000000" value={Number.isFinite(amount) ? amount : ''} onChange={(e) => setAmount(Number(e.target.value))} aria-invalid={!amountValid} />
                <small>{amountValid ? money(amount) : 'Invalid amount'}</small>
              </label>
              <label>Est. fees (%)
                <input type="number" inputMode="decimal" min="0" max="10" step="0.01" value={Number.isFinite(feePct) ? feePct : ''} onChange={(e) => setFeePct(Number(e.target.value))} />
              </label>
            </div>
            <div className="ai-lab__list-head">
              <h3>Companies <span className="mp-count">{shortlist.length}/{MAX_SHORTLIST} shortlisted</span> <span className="mp-count">{picked.length} to research</span></h3>
              <input type="search" className="ai-lab__search" placeholder="Filter by ticker or name" aria-label="Filter companies" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <p className="muted ai-lab__small">Shortlist decides what the picks are chosen from. Research is optional and only the ticked companies are sent; anything already researched is reused for free.</p>
            <div className="ai-lab__table" role="table" aria-label="Companies">
              <div className="ai-lab__row ai-lab__row--head" role="row">
                <span role="columnheader">Shortlist</span><span role="columnheader">Company</span><span role="columnheader">Status</span><span role="columnheader">Research</span>
              </div>
              <div className="ai-lab__rows">
                {portfolio.companies.filter((c) => !q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).map((c) => {
                  const state = lab.stateOf(c.ticker);
                  const on = shortlist.includes(c.ticker);
                  const researchable = researchTickers.includes(c.ticker);
                  const busyNow = state === 'queued' || state === 'researching';
                  return (
                    <div key={c.ticker} role="row" className={`ai-lab__row${on ? ' ai-lab__row--on' : ''}`}>
                      <label className="ai-lab__cell-check" aria-label={`Shortlist ${c.ticker}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.ticker)} disabled={!on && shortlist.length >= MAX_SHORTLIST} />
                      </label>
                      <span className="ai-lab__who"><b>{c.ticker}</b><small>{c.name}{heldSet.has(c.ticker) ? ' · held' : ''}</small></span>
                      <em className={`ai-lab__state ai-lab__state--${state}`}>{STATE_LABEL[state]}</em>
                      <label className="ai-lab__cell-check" aria-label={`Research ${c.ticker}`}>
                        <input type="checkbox" checked={chosen.includes(c.ticker)} disabled={!researchable || busyNow || !enabled} onChange={() => toggleChosen(c.ticker)} />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            {overLimit && <p className="mp-hint mp-hint--warn">Research requests cover up to {MAX_WATCH_TICKERS} companies at a time (shortlist first, then holdings).</p>}
            <div className="ai-lab__actions">
              {needing.length > 0 && <button type="button" className="link-button" onClick={() => setChosen(needing)}>Select all without research ({needing.length})</button>}
              {picked.length > 0 && <button type="button" className="link-button" onClick={() => setChosen([])}>Clear</button>}
              <button type="button" className="secondary" disabled={!enabled || lab.requesting || !picked.length} onClick={() => void researchPicked()}>
                {lab.requesting ? <Loader2 className="spin" size={16} /> : <Microscope size={16} />}
                {picked.length ? `Research selected (${picked.length})` : lab.working ? 'Research running…' : 'Select companies to research'}
              </button>
              <button type="button" className="ai-lab__generate" disabled={busy || saving || !enabled || !shortlist.length || !amountValid} onClick={() => void generate()}>
                {saving ? <Loader2 className="spin" size={16} /> : <FlaskConical size={16} />} Generate AI picks
              </button>
            </div>
            <p className="muted ai-lab__small">Research starts a GitHub job that reuses what is already stored, so only new filings, news and big price moves cost anything. A first run can take 10 to 30 minutes.</p>
          </section>

          {runs.length > 1 && (
            <label className="ai-lab__runs">Saved runs
              <select value={run?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.month} · {money(r.amount)} · {new Date(r.createdAt).toLocaleDateString()}</option>)}
              </select>
            </label>
          )}
          {run ? <AiLabRunView run={run} portfolio={portfolio} monthlyRun={monthlyRun} onOpenCompany={onOpenCompany} /> : <p className="muted">No AI Lab run yet. Prepare research, then generate picks.</p>}
        </>
      )}

      {section === 'holdings' && lab.data && (
        <AiLabHoldings portfolio={portfolio} research={lab.data} stateOf={lab.stateOf} requesting={lab.requesting} enabled={enabled}
          chosen={chosen} onToggle={toggleChosen} picked={picked} onResearchPicked={() => void researchPicked()} onOpenCompany={onOpenCompany} />
      )}

      {section === 'log' && lab.data && (
        <section className="ai-lab__panel">
          <h3>Research log</h3>
          <p className="muted">Provider and models are set by the research workflow (OpenAI by default). Stored work is reused, so a company is re-researched only when its inputs change.</p>
          {lab.data.macro && <p><b>Macro brief ({lab.data.macro.month}).</b> {lab.data.macro.summary}</p>}
          <div className="scroll">
            <table>
              <thead><tr><th>Company</th><th>Status</th><th>Researched</th><th>Checked</th><th>Conviction</th><th>Sources checked</th></tr></thead>
              <tbody>
                {researchTickers.map((t) => {
                  const r = lab.data!.reports.find((x) => x.ticker === t);
                  const req = lab.data!.requests.find((x) => x.ticker === t);
                  return (
                    <tr key={t}>
                      <td className="ticker">{t}</td>
                      <td>{STATE_LABEL[lab.stateOf(t)]}{req?.error ? <small>{req.error}</small> : null}</td>
                      <td>{r ? r.researchedAt.slice(0, 10) : '—'}</td>
                      <td>{r ? r.checkedAt.slice(0, 10) : '—'}</td>
                      <td>{r ? r.report.conviction : '—'}</td>
                      <td>{r ? `${r.verification.verified}/${r.verification.claims}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function AiLabRunView({ run, portfolio, monthlyRun, onOpenCompany }: {
  run: AiLabRun; portfolio: Portfolio; monthlyRun?: Portfolio['monthlyPicksRuns'] extends (infer R)[] | undefined ? R : never; onOpenCompany: (ticker: string) => void;
}) {
  const { result } = run;
  const estimates = useMemo(() => estimateAiLabBuys(result, portfolio, run.amount, run.feePct), [result, portfolio, run.amount, run.feePct]);
  const summary = useMemo(() => summarizeEstimates(estimates, run.amount), [estimates, run.amount]);
  const estimateOf = new Map(estimates.map((e) => [e.ticker, e]));
  const limits = explainSizing(result.sizing);
  return (
    <section className="ai-lab__results">
      <div className="ai-lab__summary">
        <div>
          <p className="eyebrow">AI LAB PICKS · {run.month}</p>
          <h3>{result.picks.length ? `${result.picks.length} ${result.picks.length === 1 ? 'pick' : 'picks'} for ${money(run.amount)}` : 'No company qualified this month'}</h3>
          {result.outlook && <p>{result.outlook}</p>}
          {result.macroSummary && <details><summary>Macro backdrop</summary><p>{result.macroSummary}</p></details>}
        </div>
        <dl>
          <div><dt>Allocated</dt><dd>{money(summary.allocatedPkr)}</dd></div>
          <div><dt>Cash kept</dt><dd>{money(summary.plannedCashPkr)}</dd></div>
        </dl>
      </div>
      {limits.length > 0 && <ul className="ai-lab__limits">{limits.map((line) => <li key={line}>{line}</li>)}</ul>}

      {result.picks.map((pick) => {
        const est = estimateOf.get(pick.ticker);
        return (
          <article key={pick.ticker} className="ai-lab__pick">
            <div className="ai-lab__pick-head">
              <div>
                <button type="button" className="link-button ticker" onClick={() => onOpenCompany(pick.ticker)}>{pick.ticker}</button>
                <small>{pick.name}</small>
              </div>
              <div className="ai-lab__pick-money">
                <b>{pick.allocationPct}%</b>
                <small>{est ? money(est.allocationPkr) : ''}{est?.shares ? ` · about ${est.shares} shares` : est ? ' · no current price' : ''}</small>
              </div>
            </div>
            <div className="ai-lab__metrics">
              <div><small>Conviction</small><div className="bar"><i style={{ width: `${pick.conviction}%` }} /></div><b>{pick.conviction}/100</b></div>
              <div><small>Expected {pick.expectedReturn.horizonDays}-day return</small><b>{pct(pick.expectedReturn.basePct)}</b><small>range {pct(pick.expectedReturn.lowPct)} to {pct(pick.expectedReturn.highPct)}</small></div>
              <div><small>Monthly Picks score</small><b>{pick.quantScore ?? '—'}</b></div>
              <div><small>Researched</small><b>{pick.researchedAt.slice(0, 10)}</b>{pick.carriedForward && <small>reused, nothing changed</small>}</div>
            </div>
            <p>{pick.thesis}</p>
            <div className="ai-lab__cases"><div><b>If it works</b><p>{pick.bullCase}</p></div><div><b>If it does not</b><p>{pick.bearCase}</p></div></div>
            {pick.bearReviewNote && <details><summary>Bear review</summary><p>{pick.bearReviewNote}</p></details>}
            {pick.catalysts.length > 0 && <ul className="ai-lab__list">{pick.catalysts.map((c, i) => <li key={i}><b>{c.date}</b> {c.text}{c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer"> <ExternalLink size={12} /></a>}</li>)}</ul>}
            {pick.risks.length > 0 && <ul className="ai-lab__list ai-lab__risks">{pick.risks.map((r) => <li key={r}>{r}</li>)}</ul>}
            {pick.evidence.length > 0 && (
              <details><summary>Evidence ({pick.evidence.length} checked)</summary>
                <ul className="ai-lab__list">{pick.evidence.map((e, i) => <li key={i}>✓ {e.claim}{e.factKey ? <small> · PSX data: {e.factKey}</small> : e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer"> source <ExternalLink size={12} /></a> : null}</li>)}</ul>
              </details>
            )}
          </article>
        );
      })}

      {result.excluded.length > 0 && (
        <details className="ai-lab__excluded"><summary>{result.excluded.length} shortlisted {result.excluded.length === 1 ? 'company was' : 'companies were'} not picked</summary>
          <ul className="ai-lab__list">{result.excluded.map((e) => <li key={e.ticker}><b>{e.ticker}</b> {e.reason}</li>)}</ul>
        </details>
      )}

      {monthlyRun?.result && (
        <section className="ai-lab__compare">
          <h4>Compare with Monthly Picks ({monthlyRun.month})</h4>
          <div className="ai-lab__compare-grid">
            <div><b>AI Lab</b>{result.picks.length ? result.picks.map((p) => <span key={p.ticker}>{p.ticker} {p.allocationPct}%</span>) : <span className="muted">none</span>}</div>
            <div><b>Monthly Picks</b>{monthlyRun.result.picks.length ? monthlyRun.result.picks.map((p) => <span key={p.ticker} className={result.picks.some((x) => x.ticker === p.ticker) ? 'ai-lab__both' : ''}>{p.ticker} {p.allocationPct}%</span>) : <span className="muted">none</span>}</div>
          </div>
          <small>Highlighted companies appear in both.</small>
        </section>
      )}
      <p className="muted ai-lab__small">Not investment advice. Estimates use dated PSX prices; nothing is bought or recorded automatically.</p>
    </section>
  );
}
