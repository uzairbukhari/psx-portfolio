'use client';
// Monthly Picks, as one decision: the amount (from your SIP Blueprint), a shortlist that ranks itself as you tick, and an
// order ticket with whole shares. The ranking is worked out on this device from public data; nothing is saved until you
// record the buys.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money, type Portfolio, type Quote } from '@/lib/portfolio';
import { estimateMonthlyPicks, summarizeEstimates } from '@/lib/monthly-picks';
import { heldValues, runLocalPicks, type StoredPicksRun } from '@/lib/picks-local';
import { leftOutNotes, orderText, picksRows } from '@/lib/picks-view';
import type { PicksBudget } from '@/lib/sip-blueprint-data';
import { track } from './analytics';
import PicksRecordDialog, { type PickBuyRow, type PickDestination } from './picks-record';
import PicksShortlist, { MAX_SHORTLIST } from './picks-shortlist';
import PicksTrackCard from './picks-track';
import PicksTicket, { PicksDock } from './picks-ticket';
import PicksWhy from './picks-why';
import { TabLoader } from './tab-loader';
import { useListQuotes } from './use-list-quotes';
import { useRecommendations } from './use-recommendations';

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
  /** Saves the buys as ledger entries (and the ranking beside them when they go to the Picks portfolio). */
  onRecordBatch: (input: { rows: PickBuyRow[]; month: string; date: string; destinationId: string; run: StoredPicksRun | null }) => Promise<void>;
  destinations: PickDestination[];
  defaultDestination: string;
  onOpenCompany: (ticker: string) => void;
  /** Set when the person came from Insights to balance a heavy holding: these tickers sit out this run. Held in memory only. */
  hint?: { avoid: string[] } | null;
  onClearHint?: () => void;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

export default function MonthlyPicks({
  portfolio, month, setMonth, feePct, setFeePct, sipBudget, busy, onSave, onRefreshPrices, onManualPrice, onRecordBatch,
  destinations, defaultDestination, onOpenCompany, hint, onClearHint,
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

  const [order, setOrder] = useState<'ranked' | 'name'>('ranked');
  const [openTicker, setOpenTicker] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [copied, setCopied] = useState(false);
  // Coming from Insights to balance the portfolio: leave the heavy holdings out of this month's shortlist.
  const [appliedHint, setAppliedHint] = useState<Props['hint']>(null);
  if (hint && hint !== appliedHint) {
    setAppliedHint(hint);
    setShortlist((current) => current.filter((t) => !hint.avoid.includes(t)));
  }
  const recs = useRecommendations({ portfolio, tickers: useMemo(() => list.map((e) => e.ticker), [list]), onSave });

  // List edits are instant on screen and saved in the background a moment after the last change (and when leaving).
  const latest = useRef({ list, shortlist, portfolio, onSave, feePct, month, amount, sipBudget });
  const dirty = useRef(false);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const setErrorRef = useRef(recs.setError);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    latest.current = { list, shortlist, portfolio, onSave, feePct, month, amount, sipBudget };
    setErrorRef.current = recs.setError;
  });
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const { list: l, shortlist: sl, portfolio: pf, onSave: save, feePct: fee, month: m, amount: money_, sipBudget: plan } = latest.current;
    // Without a SIP Blueprint the amount a person typed is the month's budget, as it always was; with one it comes from the plan.
    const budgets = !plan && amountTouched.current && Number.isFinite(money_) && money_ > 0 ? { ...pf.budgets, [m]: money_ } : pf.budgets;
    try {
      await save({ ...pf, monthlyPicksList: l, monthlyPicksShortlist: sl, monthlyPicksFeePct: fee, budgets }, 'Monthly Picks list saved.');
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

  const addToList = useCallback((entries: Entry[], tick = true) => {
    setListState((current) => {
      const have = new Set(current.map((e) => e.ticker));
      const fresh = entries.filter((e) => !have.has(e.ticker));
      return fresh.length ? [...fresh, ...current] : current;
    });
    if (tick) setShortlist((current) => [...current, ...entries.map((e) => e.ticker).filter((t) => !current.includes(t))].slice(0, MAX_SHORTLIST));
    schedule();
  }, [schedule]);
  const removeFromList = useCallback((ticker: string) => {
    setListState((current) => current.filter((e) => e.ticker !== ticker));
    setShortlist((current) => current.filter((t) => t !== ticker));
    schedule();
  }, [schedule]);
  const toggle = useCallback((ticker: string) => {
    setShortlist((current) => (current.includes(ticker) ? current.filter((t) => t !== ticker) : current.length < MAX_SHORTLIST ? [...current, ticker] : current));
    schedule();
  }, [schedule]);

  // List companies need not be saved companies, so their prices are held in memory rather than in the portfolio.
  const listQuotes = useListQuotes(useMemo(() => list.map((e) => e.ticker), [list]));
  const [manualQuotes, setManualQuotes] = useState<Record<string, Quote>>({});
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
  const names = useMemo(() => Object.fromEntries(list.map((e) => [e.ticker, e.name])), [list]);

  // The ranking is worked out here from the public analysis; it moves as you tick, with no save and no wait.
  const held = useMemo(() => heldValues(pricedPortfolio), [pricedPortfolio]);
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= 1e9;
  const feeValid = Number.isFinite(feePct) && feePct >= 0 && feePct <= 10;
  const { analysis } = recs;
  const analysisFits = !!analysis && shortlist.length > 0 && shortlist.every((t) => analysis.companies.some((c) => c.ticker === t));
  const run = useMemo<StoredPicksRun | null>(
    () => (analysis && analysisFits && amountValid && feeValid
      ? runLocalPicks({ analysis, month, amount, feePct, shortlist, holdings: held })
      : null),
    [analysis, analysisFits, amountValid, feeValid, month, amount, feePct, shortlist, held],
  );
  const result = run?.result ?? null;
  const estimates = useMemo(() => {
    if (!result || !run) return [];
    try {
      return estimateMonthlyPicks(result, pricedPortfolio, run.amount, run.feePct);
    } catch {
      return [];
    }
  }, [result, run, pricedPortfolio]);
  const summary = useMemo(() => summarizeEstimates(estimates, amountValid ? amount : 0), [estimates, amount, amountValid]);

  const trackedUse = useRef(false);
  useEffect(() => {
    if (estimates.length && !trackedUse.current) {
      trackedUse.current = true;
      track('picks_run_completed');
    }
  }, [estimates.length]);

  const rows = useMemo(
    () => picksRows({ list, shortlist, result, facts: recs.facts, held, order }),
    [list, shortlist, result, recs.facts, held, order],
  );
  const leftOut = useMemo(() => leftOutNotes(rows), [rows]);
  const missingOwn = portfolio.companies.filter((company) => !list.some((e) => e.ticker === company.ticker));
  const needData = shortlist.filter((t) => recs.facts[t]?.state !== 'fresh').length;
  const priceDate = estimates.map((e) => e.priceDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const recordable = estimates.filter((e) => (e.shares ?? 0) > 0);
  const stepState = (step: 1 | 2 | 3 | 4) => {
    const here = sipBudget?.done || recorded ? 4 : result && estimates.length ? 3 : shortlist.length ? 2 : 1;
    return step < here || (here === 4 && step === 4) ? 'done' : step === here ? 'on' : 'todo';
  };

  async function record(rowsToSave: PickBuyRow[], options: { date: string; destinationId: string }) {
    window.clearTimeout(timer.current);
    await flushRef.current();
    // Let the list save settle so this save starts from the latest revision.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await onRecordBatch({ rows: rowsToSave, month, date: options.date, destinationId: options.destinationId, run });
    setRecorded(true);
  }

  async function copyOrder() {
    try {
      await navigator.clipboard.writeText(orderText(estimates, month));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      recs.setError('Copying is not allowed in this browser. Select the order from the ticket instead.');
    }
  }

  if (!recs.loaded)
    return (
      <div className="mp2">
        {hint?.avoid.length ? <HintNote hint={hint} onClear={onClearHint} /> : null}
        <TabLoader label="Loading Monthly Picks…" />
      </div>
    );

  const canRecord = !busy && destinations.some((d) => !d.locked);
  return (
    <div className="mp2">
      {hint?.avoid.length ? <HintNote hint={hint} onClear={onClearHint} /> : null}

      <section className="slab mp2-slab" aria-label="This month">
        <div className="mp2-slab__top">
          <div>
            <p className="lbl">{monthTitle(month)} · stocks</p>
            <h2>Where should {amountValid ? money(amount) : 'this month’s money'} go this month?</h2>
            <p className="mu">Ranked from public PSX data on this device. Your amount and holdings never leave it.</p>
            {sipBudget && (
              <span className="mp2-source">
                From your SIP Blueprint: {money(sipBudget.planned)} planned{sipBudget.bought > 0 ? `, ${money(sipBudget.bought)} bought` : ''}
              </span>
            )}
          </div>
          <div className="mp2-fields">
            <label>
              Contribution month
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!next) return;
                  setMonth(next);
                  if (sipBudget && next === sipBudget.month) setAmount(sipBudget.amount);
                }}
              />
            </label>
            <label>
              Fresh money (PKR)
              <input
                type="number" inputMode="numeric" min="1" max="1000000000" step="1"
                value={Number.isFinite(amount) ? amount : ''}
                onChange={(event) => { setAmount(Number(event.target.value)); schedule(); }}
                aria-invalid={!amountValid}
              />
              <small>{amountValid ? '' : 'Enter an amount between 1 and 1,000,000,000.'}</small>
            </label>
            <label>
              Est. fees (%)
              <input
                type="number" inputMode="decimal" min="0" max="10" step="0.01"
                value={Number.isFinite(feePct) ? feePct : ''}
                onChange={(event) => { setFeePct(Number(event.target.value)); schedule(); }}
                aria-invalid={!feeValid}
              />
            </label>
          </div>
        </div>
        <ol className="mp2-steps" aria-label="Progress this month">
          {(['Shortlist', 'Ranked', 'Buy', 'Done'] as const).map((label, i) => {
            const state = stepState((i + 1) as 1 | 2 | 3 | 4);
            return <li key={label} data-state={state}>{state === 'done' ? '✓ ' : `${i + 1} `}{label}</li>;
          })}
        </ol>
      </section>

      {recs.error && (
        <div className="notice error" role="alert">
          {recs.error}
          <button type="button" data-slot="plain" className="link-button" onClick={() => recs.setError(null)}>Dismiss</button>
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
          <button type="button" data-slot="plain" className="link-button" onClick={() => setPriceFor(null)}>Cancel</button>
          <small>Used for this estimate while this page is open. {priceFor} is on your Monthly Picks list, not in your portfolio.</small>
        </form>
      )}
      {listQuotes.message && <p className="muted">{listQuotes.message}</p>}
      {run?.status === 'failed' && <p className="mp2-callout" role="status">{run.error}</p>}

      <div className="mp2-cols">
        <PicksShortlist
          rows={rows}
          shortlistCount={shortlist.length}
          order={order}
          setOrder={setOrder}
          onToggle={toggle}
          onClearTicks={() => { setShortlist([]); schedule(); }}
          onRemove={removeFromList}
          onAdd={(entry) => addToList([entry])}
          missingOwn={missingOwn.length}
          onAddSaved={() => addToList(missingOwn.map((company) => ({ ticker: company.ticker, name: company.name })), false)}
          openTicker={openTicker}
          onOpen={setOpenTicker}
          needData={needData}
          canFetch={recs.dispatchEnabled}
          fetching={recs.refreshing}
          onFetch={() => void recs.refreshFacts(shortlist.filter((t) => recs.facts[t]?.state !== 'fresh')).catch((e: unknown) => recs.setError(e instanceof Error ? e.message : String(e)))}
          why={(ticker) => {
            const pickIndex = result?.picks.findIndex((p) => p.ticker === ticker) ?? -1;
            return (
              <PicksWhy
                ticker={ticker}
                company={analysis?.companies.find((c) => c.ticker === ticker)}
                score={analysis?.scores.find((s) => s.ticker === ticker)}
                pick={pickIndex >= 0 ? estimates[pickIndex] : undefined}
                rank={pickIndex + 1}
                total={estimates.length}
                tag={rows.find((r) => r.ticker === ticker)?.tag ?? null}
                benchmarkSample={analysis?.benchmark?.sample ?? null}
                onOpenCompany={openCompany}
              />
            );
          }}
        />
        <PicksTicket
          estimates={estimates}
          summary={summary}
          result={result}
          feePct={feePct}
          leftOut={leftOut}
          priceDate={priceDate}
          canRecord={canRecord}
          copied={copied}
          onRecord={() => setRecording(true)}
          onCopy={() => void copyOrder()}
          onRefreshPrices={() => void Promise.all([onRefreshPrices(), listQuotes.refresh()])}
          onManualPrice={(ticker) => {
            if (portfolio.companies.some((c) => c.ticker === ticker)) return onManualPrice(ticker);
            setPriceFor(ticker);
            setPriceText(String(pricedPortfolio.quotes[ticker]?.price ?? ''));
          }}
        />
      </div>

      <PicksDock
        spend={summary.incomplete ? null : summary.estimatedSpendPkr}
        left={summary.unspentPkr}
        recordable={recordable.length}
        disabled={!canRecord}
        onRecord={() => setRecording(true)}
      />

      <PicksTrackCard portfolio={portfolio} asOf={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })} />

      {!!recs.history.length && (
        <details className="mp-history">
          <summary>Rankings saved with your buys <span className="mp-count">{recs.history.length}</span></summary>
          <ul>
            {recs.history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-slot="plain"
                  className="mp-history__item"
                  onClick={() => {
                    setMonth(item.month);
                    setAmount(item.amount);
                    setFeePct(item.feePct);
                    setShortlist(item.shortlist.filter((t) => list.some((e) => e.ticker === t)).slice(0, MAX_SHORTLIST));
                  }}
                >
                  <b>{monthTitle(item.month)}</b>
                  <span>{money(item.amount)}</span>
                  <span>{item.shortlist.length} companies</span>
                  <small>Load these inputs · {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {recording && (
        <PicksRecordDialog
          estimates={estimates}
          names={names}
          month={month}
          feePct={feePct}
          destinations={destinations}
          defaultDestination={defaultDestination}
          planned={sipBudget?.planned ?? null}
          bought={sipBudget?.bought ?? 0}
          busy={busy}
          onClose={() => setRecording(false)}
          onSave={record}
        />
      )}
    </div>
  );
}

function HintNote({ hint, onClear }: { hint: { avoid: string[] }; onClear?: () => void }) {
  return (
    <output className="reports-note">
      To balance your portfolio, {hint.avoid.join(', ')} {hint.avoid.length === 1 ? 'is' : 'are'} left out of this month&apos;s
      shortlist, so your budget goes to your other picks. Add {hint.avoid.length === 1 ? 'it' : 'them'} back any time.{' '}
      <button type="button" data-slot="pill" onClick={onClear}>Dismiss</button>
    </output>
  );
}
