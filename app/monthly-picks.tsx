'use client';

import { useState } from 'react';
import { money, type Portfolio } from '@/lib/portfolio';
import PicksProgress from './picks-progress';
import PicksResults from './picks-results';
import PicksSetup, { MAX_SHORTLIST } from './picks-setup';
import { TabLoader } from './tab-loader';
import { isActive, useRecommendations, type Recommendation } from './use-recommendations';
import { inputDifferences } from '@/lib/monthly-picks-flow';

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
  onOpenCompany: (ticker: string) => void;
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Running', gathering: 'Gathering data', in_progress: 'Ranking', completed: 'Done', failed: 'Failed',
  completed_partial: 'Legacy', needs_evidence: 'Legacy', needs_attention: 'Legacy',
};

export default function MonthlyPicks({
  portfolio, month, setMonth, feePct, setFeePct, busy, onSave, onRefreshPrices, onManualPrice, onOpenCompany,
}: Props) {
  const initial = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies.filter((company) => company.target > 0).map((company) => company.ticker);
  const [shortlist, setShortlist] = useState<string[]>(initial.slice(0, MAX_SHORTLIST));
  const [amount, setAmount] = useState(portfolio.budgets[month] ?? 100000);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recs = useRecommendations();
  const { current } = recs;

  const currentMatches =
    current !== null &&
    current.status === 'completed' &&
    current.month === month &&
    current.amount === amount &&
    current.feePct === feePct &&
    JSON.stringify([...current.shortlist].sort()) === JSON.stringify([...shortlist].sort());

  async function generate() {
    setStarting(true);
    setExpanded(false);
    try {
      const shortlistChanged = JSON.stringify(portfolio.monthlyPicksShortlist ?? []) !== JSON.stringify(shortlist);
      if (shortlistChanged || portfolio.budgets[month] !== amount) {
        await onSave(
          { ...portfolio, monthlyPicksShortlist: shortlist, budgets: { ...portfolio.budgets, [month]: amount } },
          'Monthly Picks inputs saved.',
        );
      }
      await recs.start({ month, amount, feePct, shortlist, rerun: currentMatches });
    } catch (error) {
      recs.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  async function refreshFacts(tickers: string[]) {
    try {
      const result = await recs.refreshFacts(tickers);
      if (!result.waiting && result.reason) recs.setError(result.reason);
    } catch (error) {
      recs.setError(error instanceof Error ? error.message : String(error));
    }
  }

  const showingSaved = current !== null && !!current.result && current.status === 'completed';
  const differences = showingSaved ? inputDifferences(current, { month, amount, feePct, shortlist }) : [];
  // Selecting a saved run loads its inputs into the form so the form and the result agree.
  function selectRun(item: Recommendation) {
    recs.select(item);
    setMonth(item.month);
    setAmount(item.amount);
    setFeePct(item.feePct);
    setShortlist(item.shortlist.slice(0, MAX_SHORTLIST));
  }

  const active = current !== null && isActive(current.status);
  const legacy = current !== null && ['needs_evidence', 'needs_attention', 'completed_partial'].includes(current.status);

  if (!recs.loaded)
    return (
      <div className="monthly-picks">
        <TabLoader label="Loading Monthly Picks…" />
      </div>
    );

  return (
    <div className="monthly-picks">
      <PicksSetup
        portfolio={portfolio}
        month={month} setMonth={setMonth}
        amount={amount} setAmount={setAmount}
        feePct={feePct} setFeePct={setFeePct}
        shortlist={shortlist} setShortlist={setShortlist}
        facts={recs.facts} dispatchEnabled={recs.dispatchEnabled}
        running={recs.running || active} refreshing={recs.refreshing}
        busy={busy || starting} rerun={currentMatches}
        onGenerate={() => void generate()}
        onRefreshFacts={(tickers) => void refreshFacts(tickers)}
        collapsed={!expanded && (active || !!current?.result)}
        onExpand={() => setExpanded(true)}
        onOpenCompany={onOpenCompany}
      />

      {recs.error && (
        <div className="notice error" role="alert">
          {recs.error}
          <button type="button" className="link-button" onClick={() => recs.setError(null)}>Dismiss</button>
        </div>
      )}

      {active && current && <PicksProgress run={current} />}

      {current?.status === 'failed' && (
        <section className="mp-empty-state" aria-live="polite">
          <h3>No recommendation for this run</h3>
          <p>{current.error ?? 'The run did not finish.'}</p>
          <p className="muted">Nothing was charged for a failed data step. Adjust the shortlist or try again.</p>
        </section>
      )}

      {legacy && current && (
        <section className="mp-empty-state" aria-live="polite">
          <h3>Legacy run</h3>
          <p>This run was saved by an earlier version of Monthly Picks and is shown read-only. Generate a new run for the current workflow.</p>
          {current.error && <p className="muted">{current.error}</p>}
        </section>
      )}

      {showingSaved && !active && differences.length > 0 && (
        <output className="notice">
          The recommendation below is a saved run for {current.month}, {money(current.amount)}, {current.feePct}% fees and{' '}
          {current.shortlist.length} companies. Your form now has different {differences.join(', ')}; generate a new run to use them.
          <button type="button" className="link-button" onClick={() => selectRun(current)}>Reset form to this run</button>
        </output>
      )}

      {current?.result && !active && (
        <PicksResults run={current} portfolio={portfolio} onRefreshPrices={() => void onRefreshPrices()} onManualPrice={onManualPrice} onOpenCompany={onOpenCompany} />
      )}

      {!current && !recs.error && (
        <section className="mp-empty-state">
          <h3>No recommendations yet</h3>
          <p>Pick a shortlist above and generate your first monthly recommendation.</p>
        </section>
      )}

      {!!recs.history.length && (
        <details className="mp-history">
          <summary>Previous recommendations <span className="mp-count">{recs.history.length}</span></summary>
          <ul>
            {recs.history.map((item) => (
              <li key={item.id}>
                <button type="button" className={`mp-history__item${current?.id === item.id ? ' active' : ''}`} onClick={() => selectRun(item)}>
                  <b>{item.month}</b>
                  <span>{money(item.amount)}</span>
                  <span>{item.shortlist.length} companies</span>
                  <span className={`mp-badge mp-badge--${item.status === 'failed' ? 'negative' : item.status === 'completed' ? 'positive' : 'neutral'}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
                  <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="table-note">
        Research is a data-based estimate, not a promise of returns or an order to trade.
        Review the sources and record actual purchases separately.
      </p>
    </div>
  );
}
