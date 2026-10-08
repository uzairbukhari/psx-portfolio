'use client';

import { useState } from 'react';
import { money, type Portfolio } from '@/lib/portfolio';
import PicksProgress from './picks-progress';
import PicksResults from './picks-results';
import PicksSetup, { MAX_SHORTLIST } from './picks-setup';
import { TabLoader } from './tab-loader';
import { useRecommendations, type Recommendation } from './use-recommendations';
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
  onRecordBuys?: (picks: { ticker: string; shares: number; price: number | null }[], month: string) => void;
  onOpenCompany: (ticker: string) => void;
  onAddCompany: (company: { ticker: string; name: string; sector: string }) => Promise<void>;
  onRemoveCompany: (ticker: string) => Promise<void>;
};

const STATUS_LABEL: Record<string, string> = { completed: 'Done', failed: 'Failed' };

export default function MonthlyPicks({
  portfolio, month, setMonth, feePct, setFeePct, busy, onSave, onRefreshPrices, onManualPrice, onOpenCompany, onRecordBuys, onAddCompany, onRemoveCompany,
}: Props) {
  const initial = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies.filter((company) => company.target > 0 && !portfolio.monthlyPicksHidden?.includes(company.ticker)).map((company) => company.ticker);
  const [shortlist, setShortlist] = useState<string[]>(initial.slice(0, MAX_SHORTLIST));
  const [amount, setAmount] = useState(portfolio.budgets[month] ?? 100000);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recs = useRecommendations({ portfolio, tickers: shortlist, onSave });
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
      // The saved inputs are now part of `portfolio`; the run itself is computed locally from them.
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

  const active = recs.running;

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
        running={recs.running} refreshing={recs.refreshing}
        busy={busy || starting} rerun={currentMatches}
        onGenerate={() => void generate()}
        onRefreshFacts={(tickers) => void refreshFacts(tickers)}
        collapsed={!expanded && (active || !!current?.result)}
        onExpand={() => setExpanded(true)}
        onOpenCompany={onOpenCompany}
        onAddCompany={onAddCompany}
        onRemoveCompany={async (ticker) => {
          await onRemoveCompany(ticker);
          setShortlist((current) => current.filter((item) => item !== ticker));
        }}
      />

      {recs.error && (
        <div className="notice error" role="alert">
          {recs.error}
          <button type="button" className="link-button" onClick={() => recs.setError(null)}>Dismiss</button>
        </div>
      )}

      {recs.progress && <PicksProgress progress={recs.progress} />}

      {current?.status === 'failed' && (
        <section className="mp-empty-state" aria-live="polite">
          <h3>No recommendation for this run</h3>
          <p>{current.error ?? 'The run did not finish.'}</p>
          <p className="muted">Adjust the shortlist or try again once company data is available.</p>
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
        <PicksResults run={current} portfolio={portfolio} onRefreshPrices={() => void onRefreshPrices()} onManualPrice={onManualPrice} onOpenCompany={onOpenCompany} onRecordBuys={onRecordBuys} />
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
