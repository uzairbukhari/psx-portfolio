'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money, type Portfolio } from '@/lib/portfolio';
import { sizingIsStale } from '@/lib/monthly-picks-allocation';
import { heldValues } from '@/lib/picks-local';
import type { PicksBudget } from '@/lib/sip-blueprint-data';
import PicksProgress from './picks-progress';
import PicksResults from './picks-results';
import PicksSetup, { MAX_SHORTLIST } from './picks-setup';
import { TabLoader } from './tab-loader';
import { useListQuotes } from './use-list-quotes';
import { useRecommendations, type Recommendation } from './use-recommendations';
import { inputDifferences } from '@/lib/monthly-picks-flow';

type Props = {
  portfolio: Portfolio;
  month: string;
  setMonth: (month: string) => void;
  feePct: number;
  setFeePct: (fee: number) => void;
  /** What the SIP Blueprint still wants spent on stocks this month; the amount starts here. */
  sipBudget?: PicksBudget | null;
  busy: boolean;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
  onRefreshPrices: () => Promise<void>;
  onManualPrice: (ticker: string) => void;
  onRecordBuys?: (picks: { ticker: string; shares: number; price: number | null }[], month: string) => void;
  onOpenCompany: (ticker: string) => void;
  /** Set when the person came from Insights to balance a heavy holding: these tickers sit out this run. Held in memory only. */
  hint?: { avoid: string[] } | null;
  onClearHint?: () => void;
};

const STATUS_LABEL: Record<string, string> = { completed: 'Done', failed: 'Failed' };

export default function MonthlyPicks({
  portfolio, month, setMonth, feePct, setFeePct, sipBudget, busy, onSave, onRefreshPrices, onManualPrice, onOpenCompany, onRecordBuys, hint, onClearHint,
}: Props) {
  type Entry = { ticker: string; name: string };
  // The list is its own thing. Until the person edits it for the first time it mirrors their saved companies.
  const [list, setListState] = useState<Entry[]>(
    () => portfolio.monthlyPicksList ?? portfolio.companies.map((company) => ({ ticker: company.ticker, name: company.name })),
  );
  const initial = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies.filter((company) => company.target > 0).map((company) => company.ticker);
  const [shortlist, setShortlist] = useState<string[]>(initial.filter((t) => list.some((e) => e.ticker === t)).slice(0, MAX_SHORTLIST));
  // The amount starts from the SIP Blueprint's stocks share for the month, else the last run's, else a round number.
  const [amount, setAmountState] = useState(
    sipBudget?.amount ?? portfolio.monthlyPicksRuns?.[0]?.amount ?? portfolio.budgets[month] ?? 100000,
  );
  const amountTouched = useRef(false);
  const setAmount = useCallback((next: number) => {
    amountTouched.current = true;
    setAmountState(next);
  }, []);
  const sipAmount = sipBudget?.amount;
  useEffect(() => {
    if (sipAmount !== undefined && !amountTouched.current) setAmountState(sipAmount);
  }, [sipAmount]);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Coming from Insights to balance the portfolio: leave the heavy holdings out of this month's shortlist.
  const [appliedHint, setAppliedHint] = useState<Props['hint']>(null);
  if (hint && hint !== appliedHint) {
    setAppliedHint(hint);
    setShortlist((current) => current.filter((t) => !hint.avoid.includes(t)));
  }
  const recs = useRecommendations({ portfolio, tickers: shortlist, onSave });
  const { current } = recs;

  // List edits are instant on screen and saved in the background a moment after the last change (and when leaving).
  const latest = useRef({ list, shortlist, portfolio, onSave, feePct });
  const dirty = useRef(false);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const setErrorRef = useRef(recs.setError);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    latest.current = { list, shortlist, portfolio, onSave, feePct };
    setErrorRef.current = recs.setError;
  });
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const { list: l, shortlist: sl, portfolio: pf, onSave: save, feePct: fee } = latest.current;
    try {
      await save({ ...pf, monthlyPicksList: l, monthlyPicksShortlist: sl, monthlyPicksFeePct: fee }, 'Monthly Picks list saved.');
      failures.current = 0;
    } catch (error) {
      dirty.current = true;
      failures.current += 1;
      // Often just another save in progress: try again quietly before telling the person.
      if (failures.current < 3) timer.current = window.setTimeout(() => void flushRef.current(), 2500);
      else setErrorRef.current(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  const schedule = useCallback(() => {
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1200);
  }, [flush]);
  useEffect(() => () => void flush(), [flush]);

  const addToList = useCallback((entries: Entry[]) => {
    setListState((current) => {
      const have = new Set(current.map((e) => e.ticker));
      const fresh = entries.filter((e) => !have.has(e.ticker));
      return fresh.length ? [...fresh, ...current] : current;
    });
    schedule();
  }, [schedule]);
  const removeFromList = useCallback((ticker: string) => {
    setListState((current) => current.filter((e) => e.ticker !== ticker));
    schedule();
  }, [schedule]);

  // List companies need not be saved companies, so their prices are held in memory rather than in the portfolio.
  const listQuotes = useListQuotes(useMemo(() => list.map((e) => e.ticker), [list]));
  const [manualQuotes, setManualQuotes] = useState<Record<string, import('@/lib/portfolio').Quote>>({});
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const pricedPortfolio = useMemo(() => {
    const quotes = { ...listQuotes.quotes, ...manualQuotes };
    for (const [ticker, quote] of Object.entries(portfolio.quotes)) {
      const other = quotes[ticker];
      if (!other || quote.date >= other.date) quotes[ticker] = quote;
    }
    return { ...portfolio, quotes };
  }, [portfolio, listQuotes.quotes, manualQuotes]);
  // A list company that is not a saved company has no page in the app, so it opens on PSX instead.
  const openCompany = (ticker: string) =>
    portfolio.companies.some((company) => company.ticker === ticker)
      ? onOpenCompany(ticker)
      : void window.open(`https://dps.psx.com.pk/company/${ticker}`, '_blank', 'noopener');
  const listNames = useMemo(() => Object.fromEntries(list.map((e) => [e.ticker, e.name])), [list]);

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
      window.clearTimeout(timer.current);
      // With a SIP Blueprint the amount comes from it and lives in the run; without one it is the month's budget.
      const budgets = sipBudget ? portfolio.budgets : { ...portfolio.budgets, [month]: amount };
      if (shortlistChanged || dirty.current || portfolio.monthlyPicksFeePct !== feePct || (!sipBudget && portfolio.budgets[month] !== amount)) {
        dirty.current = false;
        await onSave(
          { ...portfolio, monthlyPicksList: list, monthlyPicksShortlist: shortlist, monthlyPicksFeePct: feePct, budgets },
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
  const stale = showingSaved && !active && sizingIsStale(current.result?.sizing, heldValues(pricedPortfolio));

  if (!recs.loaded)
    return (
      <div className="monthly-picks">
      {hint?.avoid.length ? (
        <output className="reports-note">
          To balance your portfolio, {hint.avoid.join(', ')} {hint.avoid.length === 1 ? 'is' : 'are'} left out of this month&apos;s
          shortlist, so your budget goes to your other picks. Add {hint.avoid.length === 1 ? 'it' : 'them'} back any time.{' '}
          <button type="button" data-slot="pill" onClick={onClearHint}>
            Dismiss
          </button>
        </output>
      ) : null}
        <TabLoader label="Loading Monthly Picks…" />
      </div>
    );

  return (
    <div className="monthly-picks">
      <PicksSetup
        portfolio={portfolio}
        list={list} onAddToList={addToList} onRemoveFromList={removeFromList}
        month={month} setMonth={setMonth}
        amount={amount} setAmount={setAmount}
        feePct={feePct} setFeePct={(fee) => { setFeePct(fee); schedule(); }}
        sipBudget={sipBudget ?? null}
        shortlist={shortlist} setShortlist={setShortlist}
        facts={recs.facts} dispatchEnabled={recs.dispatchEnabled}
        running={recs.running} refreshing={recs.refreshing}
        busy={busy || starting} rerun={currentMatches}
        onGenerate={() => void generate()}
        onRefreshFacts={(tickers) => void refreshFacts(tickers)}
        collapsed={!expanded && (active || !!current?.result)}
        onExpand={() => setExpanded(true)}
        onOpenCompany={openCompany}
      />

      {recs.error && (
        <div className="notice error" role="alert">
          {recs.error}
          <button type="button" className="link-button" onClick={() => recs.setError(null)}>Dismiss</button>
        </div>
      )}

      {priceFor && (
        <form
          className="notice mp-price"
          onSubmit={(event) => {
            event.preventDefault();
            const price = Number(priceText);
            if (!(price > 0)) return;
            const date = new Date().toISOString().slice(0, 10);
            setManualQuotes((current) => ({ ...current, [priceFor]: { price, date, asOf: `${date} · manually entered`, manual: true, source: `https://dps.psx.com.pk/company/${priceFor}`, fetchedAt: new Date().toISOString() } }));
            setPriceFor(null);
          }}
        >
          <label>{priceFor} price per share (PKR)
            <input type="number" min="0.0001" step="any" required value={priceText} onChange={(event) => setPriceText(event.target.value)} />
          </label>
          <button type="submit" className="compact">Use this price</button>
          <button type="button" className="link-button" onClick={() => setPriceFor(null)}>Cancel</button>
          <small>Used for this estimate while this page is open. {priceFor} is on your Monthly Picks list, not in your portfolio.</small>
        </form>
      )}
      {listQuotes.message && <p className="muted">{listQuotes.message}</p>}

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

      {stale && (
        <output className="notice">
          Your holdings changed since this ranking, so its limits may be out of date. Re-run to use today&apos;s holdings.
        </output>
      )}

      {current?.result && !active && (
        <PicksResults run={current} portfolio={pricedPortfolio} extraNames={listNames} onRefreshPrices={() => void Promise.all([onRefreshPrices(), listQuotes.refresh()])} onManualPrice={(ticker) => {
          if (portfolio.companies.some((c) => c.ticker === ticker)) return onManualPrice(ticker);
          setPriceFor(ticker);
          setPriceText(String(pricedPortfolio.quotes[ticker]?.price ?? ''));
        }} onOpenCompany={openCompany} onRecordBuys={onRecordBuys} />
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
