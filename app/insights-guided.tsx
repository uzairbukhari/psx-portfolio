'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- bars drawn with CSS are described with role=img and an aria-label */

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { accountOverview } from '@/lib/account-overview';
import { valueAsset, type Asset } from '@/lib/assets';
import {
  allocationBuckets,
  benchmarkRace,
  BUCKET_ROLES,
  budgetCompletion,
  concentrationAction,
  CONCENTRATION_LIMIT_PERCENT,
  dividendTaxView,
  dropImpact,
  fundProjection,
  fundRisk,
  heldInReference,
  hedgeStatus,
  HEDGE_TARGET,
  holdingTags,
  incomeRunRate,
  milestones,
  moneyInEvents,
  monthStrip,
  nextMoneyStep,
  monthlyPace,
  rcaSummary,
  sipStreak,
  trailingReturn,
  type Bucket,
  type BucketKey,
  type RiskBand,
} from '@/lib/insights-guided';
import { allocationTree, concentration, treeLeaves, type InsightOptions } from '@/lib/insights';
import { BENCHMARKS_AS_OF } from '@/lib/pk-benchmarks';
import { rateHistory } from '@/lib/asset-reports';
import type { FxRatesResponse } from '@/lib/fx-rates';
import type { MetalRateRow } from '@/lib/metal-rates';
import type { PricePoint } from '@/lib/price-history';
import {
  holdings,
  taxYearOf,
  today,
  TAX_RATES,
  type DisplayPart,
  type Portfolio,
} from '@/lib/portfolio';
import { portfolioReport } from '@/lib/portfolio-reports';
import { InsightCard, PillSwitch, Ring } from './insight-card';
import { useOpenCompany } from './ticker-link';

// ───────────────────────── mode (per device, never in the vault) ─────────────────────────

export type InsightsMode = 'guided' | 'advanced';
const MODE_KEY = 'sipwise.insightsMode';

// A tiny store so every Insights screen shares one choice and server and first client render both start Guided.
const modeListeners = new Set<() => void>();
let modeInMemory: InsightsMode = 'guided';
let modeRead = false;
function readMode(): InsightsMode {
  if (!modeRead) {
    modeRead = true;
    try {
      if (localStorage.getItem(MODE_KEY) === 'advanced') modeInMemory = 'advanced';
    } catch {
      /* private window: stay on guided */
    }
  }
  return modeInMemory;
}
const subscribeMode = (onChange: () => void) => {
  modeListeners.add(onChange);
  return () => void modeListeners.delete(onChange);
};

export function useInsightsMode() {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'guided' as InsightsMode);
  const choose = (next: InsightsMode) => {
    modeInMemory = next;
    modeRead = true;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* not saved: the choice lasts until the page closes */
    }
    for (const notify of modeListeners) notify();
  };
  return [mode, choose] as const;
}

export function ModeSwitch({ mode, onChange }: { mode: InsightsMode; onChange: (m: InsightsMode) => void }) {
  return (
    <div className="g-mode">
      <PillSwitch
        label="Level of detail"
        value={mode}
        onChange={onChange}
        options={[
          { key: 'guided', label: 'Guided' },
          { key: 'advanced', label: 'Advanced' },
        ]}
      />
      <span className="mu">
        {mode === 'guided' ? 'Plain-English view. Switch to Advanced for every chart.' : 'All the detailed charts.'}
      </span>
    </div>
  );
}

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  return r.ok ? ((await r.json()) as T) : null;
}

/** KSE-100 daily closes (public data). Null while loading; an empty list when it could not be loaded. */
export function useKse100(): PricePoint[] | null {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  useEffect(() => {
    let live = true;
    getJson<{ eod?: PricePoint[] }>('/api/price-history?ticker=KSE100')
      .then((body) => live && setPoints(body?.eod ?? []))
      .catch(() => live && setPoints([]));
    return () => {
      live = false;
    };
  }, []);
  return points;
}

// Whole rupees: nobody needs paise on a figure this size. Small prices (a share at Rs 5.43) keep them.
const WHOLE = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 });
const PAISE = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 });
const money = (n: number | null) => (n === null ? 'Unknown' : Math.abs(n) < 100 ? PAISE.format(n) : WHOLE.format(n));
const moneyShort = money;
const pct = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const BUCKET_COLOR: Record<BucketKey, string> = {
  growth: 'var(--asset-stocks)',
  stability: 'var(--asset-plans)',
  hedge: 'var(--asset-gold)',
};

// ───────────────────────── Summary ─────────────────────────

export function GuidedSummary({
  parts,
  options,
  monthlyExpenses,
  onSaveExpenses,
  onBalance,
}: {
  parts: DisplayPart[];
  options: InsightOptions;
  monthlyExpenses: number | null;
  onSaveExpenses?: (amount: number | null) => void | Promise<void>;
  /** Opens Monthly Picks leaving these tickers out of the next run. */
  onBalance?: (avoid: string[]) => void;
}) {
  const asOf = today();
  const kse = useKse100();
  const data = useMemo(() => {
    const overview = accountOverview(parts, asOf, options);
    const events = moneyInEvents(parts, asOf, options);
    const tree = allocationTree(parts, asOf, options);
    const leaves = treeLeaves(tree.root);
    const budgets: Record<string, number> = {};
    for (const p of parts)
      for (const [m, v] of Object.entries(p.portfolio.budgets ?? {})) budgets[m] = (budgets[m] ?? 0) + v;
    return {
      overview,
      events,
      leaves,
      total: tree.total,
      streak: sipStreak(events, asOf),
      budget: budgetCompletion(budgets, events, asOf),
      buckets: allocationBuckets(parts, asOf, options),
      conc: concentration(leaves),
      action: concentrationAction(leaves),
      paidIn: events.reduce((n, e) => n + e.amount, 0),
    };
  }, [parts, asOf, options]);
  const { overview, events, streak, buckets, conc, action } = data;
  const race = useMemo(
    () => benchmarkRace({ flows: events, currentValue: overview.total.value, asOf, index: kse ?? [] }),
    [events, overview.total.value, asOf, kse],
  );
  const rate = overview.returns.rate;
  const run = incomeRunRate(overview.income.months, events[0]?.date ?? null, asOf);
  const stability = buckets.buckets.find((b) => b.key === 'stability')?.value ?? 0;
  const marks = milestones({
    stabilityValue: stability,
    monthlyExpenses,
    incomeThisYear: overview.income.received,
    moneyIn: data.paidIn,
    streak,
  });
  const total = overview.total;
  const young = streak.monthsActive < 3;
  const step = nextMoneyStep(data.paidIn);
  const strip = monthStrip(events, asOf, 12);

  return (
    <div className="g-stack">
      <section className="slab ins-hero g-hero" aria-label="Your investing journey">
        <div className="g-hero-left">
          <p className="lbl">Your net worth</p>
          <p className="slab-value num">{money(total.value)}</p>
          <p className="ins-hero-sub">
            {total.gain !== null ? (
              <>
                <span className={`delta-pill ${total.gain >= 0 ? '' : 'is-loss'}`}>
                  {signedMoney(total.gain)}
                  {total.gainPercent !== null && ` · ${pct(total.gainPercent)}`}
                </span>
                <span className="mu">
                  {total.gain >= 0
                    ? 'more than you put in'
                    : 'below what you put in. A paper loss: it only becomes real if you sell.'}
                </span>
              </>
            ) : (
              <span className="mu">{total.incomplete[0] ?? 'Add every price and cost to see your gain'}</span>
            )}
          </p>
          <dl className="slab-stats">
            <div>
              <dt className="lbl">Put in</dt>
              <dd className="num">{data.paidIn > 0 ? moneyShort(data.paidIn) : '—'}</dd>
            </div>
            <div>
              <dt className="lbl">Gain per year</dt>
              <dd className="num">{rate === null ? '—' : pct(rate * 100)}</dd>
            </div>
            <div>
              <dt className="lbl">Income this year</dt>
              <dd className="num">{moneyShort(overview.income.received)}</dd>
            </div>
          </dl>
          {rate !== null && overview.returns.skippedCount > 0 && (
            <p className="g-hint">
              Gain per year leaves out {overview.returns.skippedCount} {overview.returns.skippedCount === 1 ? 'holding' : 'holdings'} with no known cost.
            </p>
          )}
          {rate === null && overview.returns.reason === 'too-short' && (
            <p className="g-hint">A yearly figure needs about 3 months of history.</p>
          )}
          <div className="g-journey">
            <p>
              <span>{step.reached ? `${moneyShort(step.reached)} reached` : 'Your journey starts here'}</span>
              <span>{step.next ? `Next goal ${moneyShort(step.next)}` : 'Every goal reached'}</span>
            </p>
            <i
              role="img"
              aria-label={`Progress to the next goal: ${Math.round(step.progress * 100)}%`}
              style={{ '--p': `${step.progress * 100}%` } as CSSProperties}
            />
          </div>
        </div>

        <div className="g-habit" role="group" aria-label="Investing habit">
          <p className="lbl">Investing habit</p>
          <p className="g-streak num">
            {streak.current}
            <small> {streak.current === 1 ? 'month' : 'months'} in a row</small>
          </p>
          <ol className="g-strip" aria-label="Last 12 months. A filled square means you invested that month.">
            {strip.map((d) => (
              <li key={d.month} data-done={d.done || undefined} data-current={d.current || undefined} title={d.month}>
                <i />
                <span>{d.label}</span>
              </li>
            ))}
          </ol>
          <p className="g-badge-sub">
            {streak.monthsActive === 0
              ? 'Your first monthly investment starts the streak.'
              : streak.thisMonthDone
                ? 'You have invested this month. Well done.'
                : streak.current > 0
                  ? 'Invest before the month ends to keep it going.'
                  : 'Start again this month. Every month counts.'}
          </p>
          {data.budget.average !== null && (
            <div className="g-budget">
              <p>
                <span>Monthly budget invested</span>
                <b className="num">{Math.round(data.budget.average * 100)}%</b>
              </p>
              <i
                role="img"
                aria-label={`Monthly budget invested: ${Math.round(data.budget.average * 100)}%`}
                style={{ '--p': `${data.budget.average * 100}%` } as CSSProperties}
              />
              <small>
                {data.budget.months.length === 1 ? 'This month' : `Last ${data.budget.months.length} months`}
              </small>
            </div>
          )}
        </div>

        <MilestoneChips
          marks={marks.filter((m) => m.key !== 'money-in')}
          monthlyExpenses={monthlyExpenses}
          onSaveExpenses={onSaveExpenses}
        />
      </section>

      {young && (
        <section className="panel g-welcome">
          <h3>Insights grow with your SIP</h3>
          <p>
            Insights unlock as your monthly SIP history grows. Keep investing: after about three months you will see how
            you compare with the market, inflation and a savings account.
          </p>
        </section>
      )}

      <div className="ins-grid">
        <InsightCard
          index={0}
          size="wide"
          eyebrow="Where your money is"
          title={allocationLine(buckets.buckets)}
          info="Every holding sits in one of three groups. Growth can grow a lot but moves up and down. Stability is steady and safe. Hedge protects you if the rupee loses value. Open a group to see what is inside."
          source="Source: latest saved prices and rates"
        >
          {buckets.total > 0 ? <Buckets buckets={buckets.buckets} /> : <div className="report-empty">No priced holdings yet.</div>}
        </InsightCard>

        <InsightCard
          index={1}
          size="third"
          eyebrow="Is your money spread out?"
          title={concentrationLine(conc.largest, conc.level)}
          info={`Spreading money across many holdings means one bad day for one company hurts less. A common guide is to keep any single holding under ${CONCENTRATION_LIMIT_PERCENT}%.`}
        >
          <ConcentrationBody action={action} conc={conc} onBalance={onBalance} />
        </InsightCard>

        <InsightCard
          index={2}
          size="wide"
          eyebrow="How you compare"
          title={raceLine(race)}
          info="We put every rupee you invested, on the day you invested it, into three other places and see what each would be worth now. The KSE-100 is the main PSX index (price only, without dividends). Inflation and bank savings are estimates."
          source={`Inflation and savings rates are estimates from public SBP and PBS figures, last checked ${BENCHMARKS_AS_OF}.`}
        >
          <RaceBars race={race} loading={kse === null} />
        </InsightCard>

        <InsightCard
          index={3}
          size="third"
          eyebrow="Money your money makes"
          title={
            'monthly' in run
              ? `At this pace you could earn about ${money(run.annual)} over the next 12 months`
              : run.reason === 'none-yet'
                ? 'No income yet. Dividends and fund profit will show up here.'
                : 'Income pace appears after about 3 months'
          }
          info="Dividends from stocks and profit paid by funds in the last 12 months, used as a guide to the next 12. Dividends can change from year to year, so this is not a promise."
        >
          <IncomeStrip months={overview.income.months} />
        </InsightCard>
      </div>
    </div>
  );
}

function allocationLine(buckets: Bucket[]) {
  const live = buckets.filter((b) => b.value > 0);
  if (!live.length) return 'Add holdings to see where your money is';
  const top = [...live].sort((a, b) => b.share - a.share)[0];
  const hedge = buckets.find((b) => b.key === 'hedge');
  if (live.length === 1) return `All your money is in ${top.label}. Spreading it adds safety.`;
  return `${Math.round(top.share)}% of your money is in ${top.label}${hedge && hedge.share < HEDGE_TARGET.min ? '. Only a little protects you against rupee falls.' : '.'}`;
}

function concentrationLine(
  largest: { name: string; share: number } | null,
  level: 'spread' | 'moderate' | 'concentrated' | null,
) {
  if (!largest) return 'Add priced holdings to check how spread out you are';
  if (level === 'spread') return 'Your money is nicely spread out';
  return `${largest.name} is ${Math.round(largest.share)}% of your money`;
}

function raceLine(race: ReturnType<typeof benchmarkRace>) {
  if (!race.available)
    return race.reason === 'too-short' ? 'Comparisons appear after about 3 months of investing' : 'Invest to see how you compare';
  const you = race.entries[0];
  const infl = race.entries.find((e) => e.key === 'inflation');
  if (!infl) return 'See how your money did against the market';
  return race.beatsInflation
    ? `Your money grew faster than prices rose (${money(you.endValue)} vs ${money(infl.endValue)} needed to keep up)`
    : `Prices rose faster than your money grew so far (${money(you.endValue)} vs ${money(infl.endValue)} needed to keep up)`;
}

function Buckets({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="g-buckets">
      <div
        className="g-seg"
        role="img"
        aria-label={`Your money by group: ${buckets.map((b) => `${b.label} ${Math.round(b.share)}%`).join(', ')}`}
      >
        {buckets
          .filter((b) => b.share > 0)
          .map((b) => (
            <i key={b.key} style={{ '--w': `${b.share}%`, '--c': BUCKET_COLOR[b.key] } as CSSProperties} />
          ))}
      </div>
      <div className="g-bucket-grid">
        {buckets.map((b) => (
          <details key={b.key} className="g-bucket" style={{ '--c': BUCKET_COLOR[b.key] } as CSSProperties}>
            <summary>
              <span className="g-dot" aria-hidden />
              <span className="g-bucket-name">{b.label}</span>
              <b className="num">{Math.round(b.share)}%</b>
              <span className="g-bucket-val num">{moneyShort(b.value)}</span>
            </summary>
            <p className="g-role">{BUCKET_ROLES[b.key]}</p>
            {b.groups.length === 0 ? (
              <p className="mu g-empty-line">
                {b.key === 'hedge' ? 'Nothing here yet. Gold, silver or dollars would go here.' : 'Nothing here yet.'}
              </p>
            ) : (
              b.groups.map((g) => (
                <div key={g.name} className="g-group">
                  <p className="g-group-head">
                    <span>{g.name}</span>
                    <b className="num">{moneyShort(g.value)}</b>
                  </p>
                  <ul>
                    {g.items.map((i) => (
                      <li key={`${i.classKey}-${i.name}`}>
                        <span>{i.name}</span>
                        <span className="num">{b.value > 0 ? `${((i.value / b.value) * 100).toFixed(0)}%` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {b.assumed && <p className="g-hint">Some funds were placed by their name. Check the fund category if this looks wrong.</p>}
          </details>
        ))}
      </div>
    </div>
  );
}

function ConcentrationBody({
  action,
  conc,
  onBalance,
}: {
  action: ReturnType<typeof concentrationAction>;
  conc: ReturnType<typeof concentration>;
  onBalance?: (avoid: string[]) => void;
}) {
  if (!conc.largest) return <div className="report-empty">No priced holdings yet.</div>;
  const top = action.over[0];
  const avoid = action.over.flatMap((o) => (o.ticker ? [o.ticker] : []));
  return (
    <div className="g-conc">
      <Ring
        percent={conc.largest.share}
        label="Largest holding"
        tone={conc.level === 'concentrated' ? 'danger' : conc.level === 'moderate' ? 'warn' : 'success'}
      />
      {top ? (
        <>
          <p className="g-conc-text">
            If {top.name} fell by 20%, your whole portfolio would drop about {dropImpact(top.share).toFixed(1)}%. Adding to other
            holdings spreads that risk.
          </p>
          {action.under.length > 0 && (
            <p className="g-hint">Could use more: {action.under.slice(0, 3).map((u) => u.name).join(', ')}</p>
          )}
          {onBalance && avoid.length > 0 && (
            <button type="button" data-slot="pill" className="g-cta" onClick={() => onBalance(avoid)}>
              Adjust in Monthly Picks
            </button>
          )}
          {onBalance && avoid.length === 0 && <p className="g-hint">The largest holding is not a stock, so Monthly Picks cannot rebalance it.</p>}
        </>
      ) : (
        <p className="g-conc-text">No single holding is above {CONCENTRATION_LIMIT_PERCENT}%. Keep adding every month.</p>
      )}
    </div>
  );
}

function RaceBars({ race, loading }: { race: ReturnType<typeof benchmarkRace>; loading: boolean }) {
  if (!race.available)
    return (
      <div className="report-empty">
        {race.reason === 'too-short'
          ? 'Come back after about 3 months of investing. A comparison over a few weeks would mislead.'
          : 'Record a purchase to see this.'}
      </div>
    );
  const max = Math.max(...race.entries.map((e) => e.endValue));
  return (
    <div className="g-race">
      <p className="g-hint">
        You put in {money(race.moneyIn)} since {race.startDate}. Here is what it would be worth now:
      </p>
      <ol>
        {race.entries.map((e) => (
          <li key={e.key} data-you={e.key === 'you' || undefined}>
            <span className="g-race-label">{e.label}</span>
            <i
              role="img"
              aria-label={`${e.label}: ${money(e.endValue)}`}
              style={{ '--w': `${(e.endValue / max) * 100}%` } as CSSProperties}
            />
            <b className="num">{moneyShort(e.endValue)}</b>
            <span className="mu num">{e.rate === null ? '' : `${pct(e.rate * 100)} a year`}</span>
          </li>
        ))}
      </ol>
      {race.omitted.map((o) => (
        <p key={o.key} className="g-hint">
          {loading && o.key === 'kse100' ? 'Loading the KSE-100…' : o.reason}
        </p>
      ))}
    </div>
  );
}

function IncomeStrip({ months }: { months: { month: string; amount: number }[] }) {
  const last = months.slice(-12);
  const max = Math.max(1, ...last.map((m) => m.amount));
  if (!last.some((m) => m.amount > 0)) return <div className="report-empty">No dividends or profit received in the last 12 months.</div>;
  const best = last.reduce((b, m) => (m.amount > b.amount ? m : b), last[0]);
  const initial = (month: string) => 'JFMAMJJASOND'[Number(month.slice(5, 7)) - 1];
  return (
    <div className="g-income-wrap">
      <div
        className="g-income"
        role="img"
        aria-label={`Income received per month over the last 12 months, total ${money(last.reduce((n, m) => n + m.amount, 0))}`}
      >
        {last.map((m) => (
          <i key={m.month} title={`${m.month}: ${money(m.amount)}`} style={{ '--h': `${(m.amount / max) * 100}%` } as CSSProperties} />
        ))}
      </div>
      <ol className="g-income-x" aria-hidden>
        {last.map((m) => (
          <li key={m.month}>{initial(m.month)}</li>
        ))}
      </ol>
      <p className="g-hint">
        Best month: {money(best.amount)} in {best.month}
      </p>
    </div>
  );
}

function MilestoneChips({
  marks,
  monthlyExpenses,
  onSaveExpenses,
}: {
  marks: { key: string; text: string }[];
  monthlyExpenses: number | null;
  onSaveExpenses?: (amount: number | null) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(monthlyExpenses ? String(monthlyExpenses) : '');
  const [editing, setEditing] = useState(false);
  if (!marks.length && !onSaveExpenses) return null;
  const parsed = Number(draft);
  const valid = draft.trim() === '' || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1e9);
  return (
    <div className="g-mile" aria-label="Milestones">
      <ul>
        {marks.slice(0, 3).map((m) => (
          <li key={m.key}>
            <span aria-hidden className="g-tick">
              ✓
            </span>
            {m.text}
          </li>
        ))}
        {onSaveExpenses && !editing && (
          <li>
            <button type="button" data-slot="pill" className="g-exp-btn" onClick={() => setEditing(true)}>
              {monthlyExpenses
                ? `Monthly expenses ${money(monthlyExpenses)} · change`
                : '+ Add monthly expenses to see how many months your savings cover'}
            </button>
          </li>
        )}
      </ul>
      {onSaveExpenses && editing && (
        <form
          className="g-exp"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            await onSaveExpenses(draft.trim() === '' ? null : Math.round(parsed));
            setEditing(false);
          }}
        >
          <label htmlFor="g-exp-input">What do you spend in a typical month? (Rs)</label>
          <input
            id="g-exp-input"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={!valid}
          />
          <button type="submit" data-slot="pill" disabled={!valid}>
            Save
          </button>
          <button type="button" data-slot="pill" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <p className="g-hint">Saved inside your encrypted account. Only you can read it.</p>
        </form>
      )}
    </div>
  );
}

// ───────────────────────── Stocks ─────────────────────────

const PAGE = 6;
type SortKey = 'value' | 'gain' | 'income';

export function GuidedStocks({ portfolio }: { portfolio: Portfolio }) {
  const asOf = today();
  const openCompany = useOpenCompany();
  const [sort, setSort] = useState<SortKey>('value');
  const [shown, setShown] = useState(PAGE);
  const report = useMemo(() => portfolioReport(portfolio), [portfolio]);
  const held = useMemo(() => holdings(portfolio).filter((h) => h.shares > 0), [portfolio]);
  const status = portfolio.taxProfile?.filerStatus ?? null;
  const tax = dividendTaxView(portfolio.dividends ?? [], status, taxYearOf(asOf), taxYearOf);
  const totalValue = held.reduce((n, h) => n + (h.value ?? 0), 0);
  const yearAgo = new Date(Date.parse(`${asOf}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const paid = new Set(
    (portfolio.dividends ?? [])
      .filter((d) => !d.voided && d.status !== 'expected' && (d.paymentDate ?? d.date) >= yearAgo)
      .map((d) => d.ticker),
  );
  const incomeBy = new Map<string, number>();
  for (const d of portfolio.dividends ?? [])
    if (!d.voided && d.status !== 'expected' && (d.paymentDate ?? d.date) >= yearAgo)
      incomeBy.set(d.ticker, (incomeBy.get(d.ticker) ?? 0) + (d.grossAmount ?? 0));
  const rows = held
    .map((h) => {
      const share = totalValue > 0 && h.value !== null ? (h.value / totalValue) * 100 : 0;
      const first =
        portfolio.trades
          .filter((t) => t.ticker === h.ticker && !t.voided)
          .map((t) => t.date)
          .sort()[0] ?? null;
      return {
        h,
        share,
        rca: rcaSummary(portfolio.trades, h.ticker, h.quote?.price ?? null),
        tags: holdingTags({ firstBuyDate: first, share, paidIncomeLastYear: paid.has(h.ticker), gain: h.gain, asOf }),
        income: incomeBy.get(h.ticker) ?? 0,
      };
    })
    .sort((a, b) =>
      sort === 'value'
        ? (b.h.value ?? -1) - (a.h.value ?? -1)
        : sort === 'gain'
          ? (b.h.gain ?? -Infinity) - (a.h.gain ?? -Infinity)
          : b.income - a.income,
    );
  const rca = rows.filter((r) => r.rca && r.rca.buys >= 2).slice(0, 4);
  const gain = report.summary.totalGain;

  if (!held.length && !(portfolio.dividends ?? []).length)
    return (
      <section className="panel g-welcome">
        <h3>No stocks yet</h3>
        <p>Your stock insights appear here once you add your first purchase.</p>
      </section>
    );

  return (
    <div className="g-stack">
      <div className="ins-grid">
        <InsightCard
          index={0}
          size="third"
          eyebrow="Paper profit or loss"
          title={
            gain === null
              ? 'Add every purchase price to see your profit or loss'
              : gain >= 0
                ? `You are ahead by ${money(gain)} on paper`
                : `You are down ${money(Math.abs(gain))} on paper`
          }
          info="A paper profit or loss is the difference between what your shares cost and what they are worth today. It only becomes real if you sell today. Markets go up and down, and long-term investors usually wait."
        >
          <div className="g-paper">
            <p className="num">{report.summary.totalGainPercent === null ? '—' : pct(report.summary.totalGainPercent)}</p>
            <p className="mu">
              {gain !== null && gain < 0
                ? 'A dip is normal. If you keep investing every month, you buy more shares while prices are low.'
                : 'Keep going. Regular investing smooths out the ups and downs.'}
            </p>
          </div>
        </InsightCard>

        <InsightCard
          index={1}
          size="wide"
          eyebrow="Dividends and tax"
          title={tax.gross > 0 ? `You received ${money(tax.net)} after tax this tax year` : 'No dividends received this tax year yet'}
          info="Companies share profit with shareholders as dividends. The government keeps part as tax before you get it: 15% if you are on the active taxpayer list (a filer), 30% if you are not."
          source={`Tax year ${taxYearOf(asOf)}`}
        >
          {tax.gross > 0 ? (
            <dl className="g-tax">
              <div>
                <dt className="lbl">Dividend declared</dt>
                <dd className="num">{money(tax.gross)}</dd>
              </div>
              <div>
                <dt className="lbl">{status ? `Tax kept (${Math.round(TAX_RATES[status] * 100)}%, ${status === 'filer' ? 'filer' : 'non-filer'})` : 'Tax kept'}</dt>
                <dd className="num">{status || tax.tax > 0 ? `−${money(tax.tax)}` : '—'}</dd>
              </div>
              <div>
                <dt className="lbl">You received</dt>
                <dd className="num">{status || tax.tax > 0 ? money(tax.net) : '—'}</dd>
              </div>
            </dl>
          ) : (
            <div className="report-empty">Dividends you receive will be listed here.</div>
          )}
          {!status && <p className="g-hint">Set your tax status in Settings. Filers pay 15% on dividends, non-filers 30%.</p>}
          {tax.estimated && <p className="g-hint">Some tax is estimated from your status. Where your broker recorded the exact tax, that is used.</p>}
        </InsightCard>
      </div>

      {rca.length > 0 && (
        <section className="panel g-rca" aria-label="Rupee-cost averaging">
          <header>
            <p className="lbl">Your monthly investing at work</p>
            <h3>Buying a little every month lowers your average price</h3>
          </header>
          <ul>
            {rca.map(({ rca: r, h }) => (
              <li key={h.ticker}>
                <button type="button" data-slot="pill" className="g-link" onClick={() => openCompany(h.ticker)}>
                  {h.ticker}
                </button>
                <PriceRange rca={r!} price={h.quote?.price ?? null} />
                <p className="g-rca-copy">
                  {r!.dipBuys > 0
                    ? `Your SIP bought ${h.ticker} ${r!.dipBuys} ${r!.dipBuys === 1 ? 'time' : 'times'} when the price was lower than your average, which brought your cost down to ${money(r!.avgCost)}.`
                    : `You have bought ${h.ticker} ${r!.buys} times. Your average price is ${money(r!.avgCost)}.`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel g-holdings" aria-label="Your holdings">
        <header className="g-holdings-head">
          <div>
            <p className="lbl">Your holdings</p>
            <h3>{held.length} {held.length === 1 ? 'company' : 'companies'}</h3>
          </div>
          <PillSwitch
            label="Sort holdings by"
            value={sort}
            onChange={(k) => {
              setSort(k);
              setShown(PAGE);
            }}
            options={[
              { key: 'value', label: 'Biggest' },
              { key: 'gain', label: 'Best gain' },
              { key: 'income', label: 'Most income' },
            ]}
          />
        </header>
        <ul className="g-hold-list">
          {rows.slice(0, shown).map(({ h, share, tags, income }) => (
            <li key={h.ticker}>
              <button type="button" data-slot="pill" className="g-hold" onClick={() => openCompany(h.ticker)}>
                <span className="g-hold-main">
                  <b>{h.ticker}</b>
                  <small>{h.name}</small>
                </span>
                <span className="g-hold-tags">
                  {tags.map((t) => (
                    <em key={t} data-tag={t}>
                      {t}
                    </em>
                  ))}
                </span>
                <span className="g-hold-num num">
                  {h.value === null ? 'No price' : moneyShort(h.value)}
                  <small>{share > 0 ? `${share.toFixed(0)}% of stocks` : ''}</small>
                </span>
                <span className={`g-hold-num num ${h.gain === null ? '' : h.gain >= 0 ? 'pos-text' : 'neg-text'}`}>
                  {h.gain === null ? '—' : signedMoney(h.gain)}
                  <small>{sort === 'income' && income > 0 ? `${moneyShort(income)} income` : 'paper gain'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {shown < rows.length && (
          <button type="button" data-slot="pill" className="g-more" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        )}
      </section>
    </div>
  );
}

function PriceRange({ rca, price }: { rca: NonNullable<ReturnType<typeof rcaSummary>>; price: number | null }) {
  const lo = Math.min(rca.low, rca.avgCost, price ?? Infinity);
  const hi = Math.max(rca.high, rca.avgCost, price ?? -Infinity);
  const at = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  return (
    <div
      className="g-range"
      role="img"
      aria-label={`Lowest buy ${money(rca.low)}, average ${money(rca.avgCost)}, highest buy ${money(rca.high)}${price !== null ? `, price now ${money(price)}` : ''}`}
    >
      <i className="g-range-span" style={{ '--a': `${at(rca.low)}%`, '--b': `${at(rca.high)}%` } as CSSProperties} />
      <i className="g-range-pin g-range-avg" style={{ '--x': `${at(rca.avgCost)}%` } as CSSProperties} data-label="Your average" />
      {price !== null && <i className="g-range-pin g-range-now" style={{ '--x': `${at(price)}%` } as CSSProperties} data-label="Now" />}
    </div>
  );
}

// ───────────────────────── Funds and plans ─────────────────────────

const RISK_LABELS: Record<RiskBand, { label: string; note: string }> = {
  low: { label: 'Low risk', note: 'Money market: very steady. Good for emergency money.' },
  medium: { label: 'Medium risk', note: 'Income funds: steady profit, small ups and downs.' },
  high: { label: 'Higher risk', note: 'Equity funds: bigger growth over years, bigger swings.' },
};

function useFundHistories(ids: string[]) {
  const key = ids.join(',');
  const [map, setMap] = useState<Record<string, { date: string; nav: number }[]>>({});
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split(',') : [])
      getJson<{ navs?: { date: string; nav: number }[] }>(`/api/public-data/funds?fund=${encodeURIComponent(id)}`)
        .then((b) => {
          if (live && b?.navs) setMap((m) => ({ ...m, [id]: b.navs! }));
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return map;
}

export function GuidedFunds({
  parts,
  options,
}: {
  parts: DisplayPart[];
  options: InsightOptions;
}) {
  const asOf = today();
  const assets = useMemo(() => parts.flatMap((p) => p.portfolio.assets ?? []), [parts]);
  const rows = useMemo(
    () =>
      assets
        .filter((a): a is Extract<Asset, { kind: 'fund' | 'plan' }> => a.kind === 'fund' || a.kind === 'plan')
        .map((a) => {
          const v = valueAsset(a, [], asOf, options.fundNavs ?? [], options.planNavs ?? [], []);
          return {
            id: a.id,
            name: a.name,
            kind: a.kind,
            category: a.kind === 'fund' ? a.category : 'Savings plan',
            mufapId: a.kind === 'fund' ? a.mufapId : null,
            value: v.value ?? 0,
            known: v.value !== null,
            flows: v.flows,
            risk: a.kind === 'fund' ? fundRisk(a.category) : ('low' as RiskBand),
          };
        })
        .filter((r) => r.value > 0 || r.flows.length > 0),
    [assets, asOf, options.fundNavs, options.planNavs],
  );
  const total = rows.reduce((n, r) => n + r.value, 0);
  const histories = useFundHistories(rows.flatMap((r) => (r.mufapId ? [r.mufapId] : [])));
  const flows = rows.flatMap((r) => r.flows);
  const pace = monthlyPace(flows, asOf, 6);
  const [monthly, setMonthly] = useState<number | null>(null);
  const useMonthly = monthly ?? pace;
  const returns = rows.flatMap((r) => {
    const t = r.mufapId ? trailingReturn(histories[r.mufapId] ?? []) : null;
    return t === null ? [] : [{ r, t }];
  });
  const weighted = returns.length
    ? returns.reduce((n, x) => n + x.t * x.r.value, 0) / Math.max(1, returns.reduce((n, x) => n + x.r.value, 0))
    : null;
  const FALLBACK = 12;
  const base = weighted !== null ? Math.min(25, Math.max(4, weighted)) : FALLBACK;
  const projection = fundProjection({ current: total, monthly: useMonthly, basePercent: base });

  if (!rows.length)
    return (
      <section className="panel g-welcome">
        <h3>No funds or plans yet</h3>
        <p>Mutual funds are a steady way to grow money and park savings. Add one and see how it fits here.</p>
      </section>
    );

  const bands = (['low', 'medium', 'high'] as RiskBand[]).map((band) => {
    const mine = rows.filter((r) => r.risk === band);
    const value = mine.reduce((n, r) => n + r.value, 0);
    return { band, mine, value, share: total > 0 ? (value / total) * 100 : 0 };
  });

  return (
    <div className="g-stack">
      <div className="g-split">
        <InsightCard
          index={0}
          size="half"
          eyebrow="Risk spectrum"
          title={`${money(total)} in funds and plans, ${Math.round(bands[0].share)}% in the lowest-risk kind`}
          info="Funds do not move like single stocks. Money market and income funds are built to grow steadily and protect your capital. Equity funds take more risk for more growth over years."
        >
          <div className="g-spectrum">
            {bands.map((b) => (
              <div key={b.band} data-band={b.band} data-empty={b.value === 0 || undefined}>
                <p className="g-spec-head">
                  <b>{RISK_LABELS[b.band].label}</b>
                  <span className="num">{Math.round(b.share)}%</span>
                </p>
                <i style={{ '--w': `${b.share}%` } as CSSProperties} role="img" aria-label={`${RISK_LABELS[b.band].label}: ${Math.round(b.share)}%`} />
                <p className="mu">{RISK_LABELS[b.band].note}</p>
                {b.mine.length > 0 && <p className="g-chips">{b.mine.map((r) => <span key={r.id}>{r.name}</span>)}</p>}
              </div>
            ))}
          </div>
        </InsightCard>

        <InsightCard
          index={1}
          size="half"
          eyebrow="What steady investing could become"
          title={`${money(projection[1].base)} in 5 years if you keep going`}
          info={`A guide, not a promise. It assumes about ${base.toFixed(0)}% a year ${weighted !== null ? "(your funds' recent record)" : '(a typical figure, because there is not enough price history yet)'} and the monthly amount below. Real returns go up and down.`}
          source="Estimate only. Past returns do not guarantee future returns."
        >
          <div className="g-proj">
            <label htmlFor="g-proj-slider">
              Monthly amount: <b className="num">{money(useMonthly)}</b>
              {monthly === null && pace > 0 ? ' (your recent pace)' : ''}
            </label>
            <input
              id="g-proj-slider"
              type="range"
              min={0}
              max={Math.max(50_000, Math.ceil((pace * 3) / 5000) * 5000)}
              step={1000}
              value={useMonthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
            />
            <ul>
              {projection.map((p) => (
                <li key={p.years}>
                  <div className="g-col-wrap">
                    <div
                      className="g-col"
                      role="img"
                      aria-label={`After ${p.years} years: you put in ${money(p.contributed)}, estimated growth ${money(Math.max(0, p.base - p.contributed))}`}
                      style={
                        {
                          '--h': `${(p.base / Math.max(1, projection[projection.length - 1].base)) * 100}%`,
                          '--in': Math.max(0.0001, Math.min(p.contributed, p.base)),
                          '--gain': Math.max(0.0001, p.base - p.contributed),
                        } as CSSProperties
                      }
                    >
                      <i className="g-col-in" />
                      <i className="g-col-gain" />
                    </div>
                  </div>
                  <span className="lbl">{p.years} years</span>
                  <b className="num">{moneyShort(p.base)}</b>
                  <small className="num">
                    {moneyShort(p.low)} to {moneyShort(p.high)}
                  </small>
                  <small>You put in {moneyShort(p.contributed)}</small>
                </li>
              ))}
            </ul>
            <p className="g-legend">
              <span data-k="in">You put in</span>
              <span data-k="gain">Estimated growth</span>
            </p>
          </div>
        </InsightCard>
      </div>

      <section className="panel g-fundlist" aria-label="How your funds have done">
        <header>
          <p className="lbl">How your funds have done</p>
          <h3>Average yearly growth, from saved MUFAP prices</h3>
        </header>
        <ul>
          {rows.map((r) => {
            const t = r.mufapId ? trailingReturn(histories[r.mufapId] ?? []) : null;
            return (
              <li key={r.id}>
                <span>
                  <b>{r.name}</b>
                  <small>{r.category}</small>
                </span>
                <span className="num">{moneyShort(r.value)}</span>
                <span className={`num ${t === null ? 'mu' : t >= 0 ? 'pos-text' : 'neg-text'}`}>
                  {r.kind === 'plan' ? 'Statement value' : t === null ? 'Needs 3 months of prices' : `${pct(t)} a year`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ───────────────────────── Currency and metals: the rupee hedge ─────────────────────────

type RatePointLike = { date: string; rate: number };
const priceOnFrom = (points: RatePointLike[]) => {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  return (date: string): number | null => {
    let found: number | null = null;
    for (const p of sorted) {
      if (p.date <= date) found = p.rate;
      else break;
    }
    return found;
  };
};

export function GuidedHedge({
  parts,
  options,
  metalRates,
  fx,
}: {
  parts: DisplayPart[];
  options: InsightOptions;
  metalRates: MetalRateRow[];
  fx: FxRatesResponse;
}) {
  const asOf = today();
  const { buckets, total } = useMemo(() => allocationBuckets(parts, asOf, options), [parts, asOf, options]);
  const hedge = buckets.find((b) => b.key === 'hedge')!;
  const status = hedgeStatus(hedge.share);
  const events = useMemo(() => moneyInEvents(parts, asOf, options), [parts, asOf, options]);
  const goldPoints = useMemo(() => rateHistory(metalRates, 'gold').map((p) => ({ date: p.date, rate: p.rate })), [metalRates]);
  const usd = useMemo(() => {
    const rows = fx.history.filter((h) => h.currency === 'USD' && h.kind === 'interbank');
    const use = rows.length >= 2 ? rows : fx.history.filter((h) => h.currency === 'USD');
    return use.map((h) => ({ date: h.date, rate: h.rate }));
  }, [fx.history]);
  const asUsd = heldInReference(events, priceOnFrom(usd), usd.at(-1)?.rate ?? null);
  const asGold = heldInReference(events, priceOnFrom(goldPoints), goldPoints.at(-1)?.rate ?? null);
  const paidIn = events.reduce((n, e) => n + e.amount, 0);

  if (hedge.value <= 0 && !(asUsd || asGold))
    return (
      <section className="panel g-welcome">
        <h3>Protect yourself against a falling rupee</h3>
        <p>
          When the rupee loses value, prices rise and savings buy less. Gold, silver and foreign currency usually hold
          their value better. Many advisers suggest keeping {HEDGE_TARGET.min}% to {HEDGE_TARGET.max}% of your money in
          them. You have none yet.
        </p>
      </section>
    );

  return (
    <div className="g-stack">
      <div className="g-split">
        <InsightCard
          index={0}
          size="half"
          eyebrow="Rupee protection"
          title={
            status === 'in'
              ? `${Math.round(hedge.share)}% of your money is protected. That is a healthy level.`
              : status === 'below'
                ? `Only ${Math.round(hedge.share)}% of your money is protected against rupee falls`
                : `${Math.round(hedge.share)}% is in protection. That is more than most advisers suggest.`
          }
          info={`Gold, silver and foreign currency (dollars, dirhams, riyals) tend to hold their value when the rupee loses value. A common guide is ${HEDGE_TARGET.min}% to ${HEDGE_TARGET.max}% of your total money. They do not pay income, so you do not need more than that.`}
        >
          <div className="g-hedge">
            <Ring percent={hedge.share} label="Share of your money in rupee protection" tone={status === 'in' ? 'success' : 'warn'} />
            <div>
              <p className="g-guide">
                Guide: <b>{HEDGE_TARGET.min}% to {HEDGE_TARGET.max}%</b>
              </p>
              <p className="mu">
                {status === 'below'
                  ? `A little more in gold or foreign currency would bring you into the guide range.`
                  : status === 'above'
                    ? 'Consider keeping the rest growing in stocks and funds.'
                    : 'You are inside the guide range.'}
              </p>
              <p className="g-hint">Total considered: {money(total)}</p>
            </div>
          </div>
        </InsightCard>

        <InsightCard
          index={1}
          size="half"
          eyebrow="Does your money keep its power?"
          title={
            asUsd !== null || asGold !== null
              ? `Your ${moneyShort(paidIn)} would be worth ${[asUsd !== null ? `${moneyShort(asUsd)} in dollars` : null, asGold !== null ? `${moneyShort(asGold)} in gold` : null].filter(Boolean).join(' or ')} today`
              : 'Rate history is not long enough to compare yet'
          }
          info="We take every rupee you invested and imagine you had bought dollars, or gold, that same day instead. This shows how much buying power rupees lost over the same time."
          source="Uses saved interbank dollar rates and gold rates. An estimate, before any fees."
        >
          <ol className="g-power">
            <li>
              <span>Money you put in</span>
              <b className="num">{moneyShort(paidIn)}</b>
            </li>
            <li data-you>
              <span>What it is worth now in your portfolio</span>
              <b className="num">{moneyShort(total)}</b>
            </li>
            {asUsd !== null && (
              <li>
                <span>If kept in US dollars</span>
                <b className="num">{moneyShort(asUsd)}</b>
              </li>
            )}
            {asGold !== null && (
              <li>
                <span>If kept in gold</span>
                <b className="num">{moneyShort(asGold)}</b>
              </li>
            )}
          </ol>
        </InsightCard>
      </div>

      <section className="panel g-fundlist" aria-label="Your protection holdings">
        <header>
          <p className="lbl">What protects you</p>
          <h3>Gold, silver and foreign currency you hold</h3>
        </header>
        {hedge.groups.length === 0 ? (
          <p className="mu">Nothing held yet.</p>
        ) : (
          <ul>
            {hedge.groups.flatMap((g) =>
              g.items.map((i) => (
                <li key={`${g.name}-${i.name}`}>
                  <span>
                    <b>{i.name}</b>
                    <small>{g.name}</small>
                  </span>
                  <span className="num">{moneyShort(i.value)}</span>
                  <span className="mu num">{total > 0 ? `${((i.value / total) * 100).toFixed(0)}% of your money` : ''}</span>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
