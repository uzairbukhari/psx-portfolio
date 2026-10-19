'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { EChart } from './charts/echart';
import {
  classColor,
  compact,
  hBarOption,
  heatmapOption,
  sparklineOption,
  stackedAreaOption,
  treemapOption,
  waterfallOption,
  type ChartTokens,
  type TreeNode,
} from '@/lib/chart-kit';
import { money, moneyShort, today, type DisplayPart, type Portfolio } from '@/lib/portfolio';
import { accountOverview } from '@/lib/account-overview';
import {
  allocationTakeaway,
  allocationTree,
  bridgeTakeaway,
  concentration,
  concentrationTakeaway,
  cumulativeByClass,
  moneyInTakeaway,
  reportClasses,
  monthCalendar,
  returnBridge,
  treeLeaves,
  type InsightNode,
} from '@/lib/insights';
import type { Asset } from '@/lib/assets';
import type { MetalRateRow } from '@/lib/metal-rates';
import type { FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';
import type { FxRatesResponse } from '@/lib/fx-rates';
import type { ReportMode } from '@/lib/asset-reports';
import { useOpenCompany } from './ticker-link';
import { InsightCard, PillSwitch, Ring } from './insight-card';
import PortfolioReports from './portfolio-reports';
import AssetReports from './asset-reports';

const NO_FX: FxRatesResponse = { rates: [], history: [] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const monthLabel = (iso: string, long: boolean) => {
  const [y, m] = iso.split('-').map(Number);
  return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};

type Kind = 'stocks' | 'metals' | 'funds' | 'currency';
const KIND_LABELS: Record<Kind, string> = {
  stocks: 'Stocks',
  metals: 'Gold & silver',
  funds: 'Funds & plans',
  currency: 'Currency',
};

const toTree = (t: ChartTokens, nodes: InsightNode[]): TreeNode[] =>
  nodes.map((n) => ({
    name: n.name,
    value: n.children?.length ? undefined : n.value,
    ticker: n.ticker,
    color: classColor(t, n.classKey),
    children: n.children ? toTree(t, n.children) : undefined,
  }));

/**
 * The Insights page for the All view: one summary of a few cross-asset cards, and an "Explore by class" switch that
 * opens the detailed reports of one asset class at a time. The classes are never stacked on one page.
 */
export function AllInsights({
  portfolio,
  parts,
  assets,
  metalRates,
  fundNavs,
  planNavs,
  fx = NO_FX,
}: {
  portfolio: Portfolio;
  parts: DisplayPart[];
  assets: Asset[];
  metalRates: MetalRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
  fx?: FxRatesResponse;
}) {
  const asOf = today();
  const openCompany = useOpenCompany();
  const [view, setView] = useState<'summary' | Kind>('summary');
  const [calendar, setCalendar] = useState<'income' | 'invested'>('income');
  const merged: Portfolio = { ...portfolio, assets };

  const has: Record<Kind, boolean> = {
    stocks:
      portfolio.trades.some((t) => !t.voided) ||
      !!portfolio.dividends?.some((d) => !d.voided),
    metals: assets.some((a) => a.kind === 'metal'),
    funds: assets.some((a) => a.kind === 'fund' || a.kind === 'plan'),
    currency: assets.some((a) => a.kind === 'currency'),
  };
  const kinds = (Object.keys(KIND_LABELS) as Kind[]).filter((k) => has[k]);

  const options = useMemo(
    () => ({ metalRates, fundNavs, planNavs, fxRates: fx.rates }),
    [metalRates, fundNavs, planNavs, fx.rates],
  );
  const data = useMemo(() => {
    const overview = accountOverview(parts, asOf, options);
    const tree = allocationTree(parts, asOf, options);
    const money_in = cumulativeByClass(parts, asOf, options);
    return {
      overview,
      tree,
      leaves: treeLeaves(tree.root),
      moneyIn: money_in,
      bridge: returnBridge(overview, parts),
      cal: monthCalendar(parts, asOf, options),
    };
  }, [parts, asOf, options]);
  const { overview, tree, moneyIn, bridge, cal } = data;
  const conc = useMemo(() => concentration(data.leaves), [data.leaves]);
  const topFive = useMemo(
    () => [...data.leaves].sort((a, b) => b.value - a.value).slice(0, 5),
    [data.leaves],
  );
  const tickers = useMemo(
    () => new Set(data.leaves.flatMap((l) => (l.ticker ? [l.ticker] : []))),
    [data.leaves],
  );

  if (!kinds.length)
    return (
      <div className="ins">
        <div className="report-empty">Add holdings to a portfolio to see your insights.</div>
      </div>
    );

  const total = overview.total;
  const spark = moneyIn.months.map((_, i) =>
    moneyIn.series.reduce((n, s) => n + s.data[i], 0),
  );
  const paidIn = spark.length ? spark[spark.length - 1] : 0;
  const gainTone = total.gain === null ? '' : total.gain >= 0 ? '' : 'is-loss';
  const rate = overview.returns.rate;
  const calRows = calendar === 'income' ? cal.income : cal.invested;
  const calCells: [number, number, number][] = calRows.flatMap((row, y) =>
    row.map((v, m): [number, number, number] => [m, y, v]),
  );
  const calTotal = calendar === 'income' ? cal.incomeTotal : cal.investedTotal;
  const bestMonth = calCells.reduce(
    (best, c) => (c[2] > best[2] ? c : best),
    [0, 0, 0] as [number, number, number],
  );

  return (
    <div className="ins">
      <div className="ins-top">
        <div className="reports-tabs seg" aria-label="Insights view">
          {(['summary', ...kinds] as const).map((k) => (
            <button
              key={k}
              type="button"
              data-slot="tab"
              data-active={view === k || undefined}
              onClick={() => setView(k)}
            >
              {k === 'summary' ? 'Summary' : KIND_LABELS[k]}
            </button>
          ))}
        </div>
        {view === 'summary' && (
          <p className="ins-hint">
            Everything across your portfolios in a few charts. Open a class for its detailed reports.
          </p>
        )}
      </div>

      {view === 'stocks' && <PortfolioReports portfolio={merged} />}
      {view === 'metals' && (
        <AssetReports
          portfolio={merged}
          mode="metal"
          metalRates={metalRates}
          fundNavs={fundNavs}
          planNavs={planNavs}
          fx={fx}
        />
      )}
      {view === 'funds' && (
        <AssetReports
          portfolio={merged}
          mode="savings"
          metalRates={metalRates}
          fundNavs={fundNavs}
          planNavs={planNavs}
          fx={fx}
        />
      )}
      {view === 'currency' && (
        <AssetReports
          portfolio={merged}
          mode="currency"
          metalRates={metalRates}
          fundNavs={fundNavs}
          planNavs={planNavs}
          fx={fx}
        />
      )}

      {view === 'summary' && (
        <>
          <section className="slab ins-hero" aria-label="Net worth">
            <div className="ins-hero-main">
              <p className="lbl">Net worth</p>
              <p className="slab-value num">{money(total.value)}</p>
              <p className="ins-hero-sub">
                {total.gain !== null ? (
                  <span className={`delta-pill ${gainTone}`}>
                    {signedMoney(total.gain)}
                    {total.gainPercent !== null && ` · ${pct(total.gainPercent)}`}
                  </span>
                ) : (
                  <span className="mu">{total.incomplete[0] ?? 'Gain needs every price and cost'}</span>
                )}
                {total.gain !== null && <span className="mu"> vs what you put in</span>}
              </p>
              <dl className="slab-stats">
                <div>
                  <dt className="lbl">Put in</dt>
                  <dd className="num">{paidIn > 0 ? moneyShort(paidIn) : '—'}</dd>
                </div>
                <div>
                  <dt className="lbl">Return a year</dt>
                  <dd className="num">{rate === null ? '—' : pct(rate * 100)}</dd>
                </div>
                <div>
                  <dt className="lbl">Income {overview.income.taxYear}</dt>
                  <dd className="num">{moneyShort(overview.income.received)}</dd>
                </div>
                <div>
                  <dt className="lbl">Holdings</dt>
                  <dd className="num">{data.leaves.length}</dd>
                </div>
              </dl>
            </div>
            {spark.length > 1 && (
              <EChart
                className="ins-spark"
                label={`Money paid in over time, now ${money(spark[spark.length - 1])}.`}
                build={(t) => sparklineOption(t, { values: spark, color: t.success })}
              />
            )}
          </section>

          <div className="ins-grid">
            <InsightCard
              index={0}
              size="wide"
              eyebrow="Where your money is"
              title={allocationTakeaway(tree.root, tree.total)}
              info="Every holding sized by its current value, grouped by asset class and, for stocks, by sector. Click a group to zoom in; click a stock to open the company."
              source={`Source: latest saved prices and rates${tree.unpriced ? ` · ${tree.unpriced} unpriced ${tree.unpriced === 1 ? 'holding is' : 'holdings are'} left out` : ''}`}
            >
              {tree.root.length ? (
                <EChart
                  className="ins-chart ins-chart--tall"
                  label={`Allocation by class and holding, total ${money(tree.total)}.`}
                  onPick={(p) => tickers.has(p.name) && openCompany(p.name)}
                  build={(t) =>
                    treemapOption(t, {
                      root: toTree(t, tree.root),
                      total: tree.total,
                      valueFormat: money,
                    })
                  }
                />
              ) : (
                <div className="report-empty">No priced holdings yet.</div>
              )}
            </InsightCard>

            <InsightCard
              index={1}
              size="third"
              eyebrow="Concentration"
              title={concentrationTakeaway(conc)}
              info="Effective holdings is how many equal-sized positions would be as concentrated as yours. A single big position makes it small."
            >
              {conc.largest ? (
                <div className="ins-conc">
                  <Ring
                    percent={conc.largest.share}
                    label="Largest holding"
                    tone={conc.level === 'concentrated' ? 'danger' : conc.level === 'moderate' ? 'warn' : 'success'}
                  />
                  <dl>
                    <div>
                      <dt className="lbl">Largest</dt>
                      <dd className="num">{conc.largest.name}</dd>
                    </div>
                    <div>
                      <dt className="lbl">Top three</dt>
                      <dd className="num">{conc.topThree?.toFixed(0)}%</dd>
                    </div>
                    <div>
                      <dt className="lbl">Effective holdings</dt>
                      <dd className="num">
                        {conc.effective?.toFixed(1)} <small>of {conc.count}</small>
                      </dd>
                    </div>
                  </dl>
                  <ol className="ins-top5">
                    {topFive.map((l) => (
                      <li key={`${l.classKey}-${l.name}`}>
                        <span>{l.name}</span>
                        <i style={{ '--w': `${(l.value / tree.total) * 100}%`, '--c': `var(--asset-${l.classKey === 'currency' ? 'fx' : l.classKey})` } as CSSProperties} />
                        <b className="num">{((l.value / tree.total) * 100).toFixed(0)}%</b>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="report-empty">No priced holdings yet.</div>
              )}
            </InsightCard>

            <InsightCard
              index={2}
              size="wide"
              eyebrow="Money in, by class"
              title={moneyInTakeaway(moneyIn.series, total.value, moneyShort)}
              info="Cumulative money paid in at each month end, stacked by asset class. Sales and redemptions reduce it; income is not money in. The dashed line is what it is worth today."
              source="Source: your buys, sales, plan contributions and fund purchases"
            >
              {moneyIn.series.length && moneyIn.months.length > 1 ? (
                <EChart
                  className="ins-chart"
                  label={`Money paid in by asset class over ${moneyIn.months.length} months.`}
                  build={(t) =>
                    stackedAreaOption(t, {
                      dates: moneyIn.dates,
                      series: moneyIn.series.map((s) => ({
                        name: s.label,
                        data: s.data,
                        color: classColor(t, s.key),
                      })),
                      valueFormat: money,
                      dateLabel: (x, long) => monthLabel(x, long),
                      refLine: { y: total.value, label: `Worth ${compact(total.value)} today`, color: t.success },
                    })
                  }
                />
              ) : (
                <div className="report-empty">Record purchases over a few months to see this.</div>
              )}
            </InsightCard>

            <InsightCard
              index={3}
              size="third"
              eyebrow="What built your return"
              title={bridgeTakeaway(bridge, signedMoney)}
              info="Gain still in each asset class, plus stock gains you already locked in and income already received. They add up to the total return. A class whose price or cost is missing is left out, never counted as zero."
              source={bridge.omitted.length ? `Left out until priced: ${bridge.omitted.join(', ')}` : 'Source: unrealised gains, realised sales, dividends and fund income'}
            >
              {bridge.steps.length > 1 ? (
                <EChart
                  className="ins-chart"
                  label={`Return bridge, total ${money(bridge.total)}.`}
                  build={(t) =>
                    waterfallOption(t, {
                      valueFormat: signedMoney,
                      steps: bridge.steps.map((s) => ({
                        label: s.label,
                        value: s.value,
                        kind: s.kind === 'total' ? 'total' : 'step',
                      })),
                    })
                  }
                />
              ) : (
                <div className="report-empty">Add costs and prices to see what built your return.</div>
              )}
            </InsightCard>

            <InsightCard
              index={4}
              size="wide"
              eyebrow="Calendar"
              title={
                calTotal > 0
                  ? `${money(calTotal)} ${calendar === 'income' ? 'of income received' : 'invested'} since ${cal.years[0]}${bestMonth[2] > 0 ? ` · best month ${MONTHS[bestMonth[0]]} ${cal.years[bestMonth[1]]}` : ''}`
                  : calendar === 'income'
                    ? 'No income received yet'
                    : 'Nothing invested yet'
              }
              info="One square per month, darker for more. Income is dividends received on their payment date (stocks and funds); invested is money paid into purchases and plans."
              aside={
                <PillSwitch
                  label="Calendar shows"
                  value={calendar}
                  onChange={setCalendar}
                  options={[
                    { key: 'income', label: 'Income' },
                    { key: 'invested', label: 'Invested' },
                  ]}
                />
              }
            >
              {cal.years.length ? (
                <EChart
                  className="ins-chart ins-chart--cal"
                  label={`${calendar === 'income' ? 'Income received' : 'Money invested'} by month and year.`}
                  build={(t) =>
                    heatmapOption(t, {
                      cols: MONTHS,
                      rows: cal.years.map(String),
                      cells: calCells,
                      color: calendar === 'income' ? t.success : t.primary,
                      valueFormat: money,
                    })
                  }
                />
              ) : (
                <div className="report-empty">No history yet.</div>
              )}
            </InsightCard>

            {overview.portfolios.length > 1 && (
              <InsightCard
                index={5}
                size="third"
                eyebrow="Portfolios side by side"
                title={`${overview.portfolios[0].name} holds ${Math.round(overview.portfolios[0].share)}% of your net worth`}
                info="Current value of each portfolio. Gain is shown when every cost and price in that portfolio is known."
              >
                <EChart
                  className="ins-chart"
                  label="Value of each portfolio."
                  build={(t) =>
                    hBarOption(t, {
                      name: 'Value',
                      cats: overview.portfolios.map((p) => p.name),
                      values: overview.portfolios.map((p) => p.value),
                      valueFormat: money,
                      labelFormat: compact,
                      color: t.primary,
                      rows: (i) => {
                        const p = overview.portfolios[i];
                        return p.gain === null
                          ? []
                          : [{ label: 'Gain', value: signedMoney(p.gain), tone: p.gain >= 0 ? 'pos' : 'neg' }];
                      },
                    })
                  }
                />
              </InsightCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const MODE_LABELS: Record<ReportMode, string> = {
  stocks: 'Stocks',
  metal: 'Gold & silver',
  savings: 'Funds & plans',
  currency: 'Currency',
};

/**
 * Insights for one portfolio: exactly the charts of the asset classes it holds. A portfolio with more than one class
 * (stocks and gold, say) gets a switch instead of every class stacked.
 */
export function PortfolioInsights({
  portfolio,
  metalRates,
  fundNavs,
  planNavs,
  fx = NO_FX,
}: {
  portfolio: Portfolio;
  metalRates: MetalRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
  fx?: FxRatesResponse;
}) {
  const classes = reportClasses(portfolio);
  const [picked, setPicked] = useState<ReportMode | null>(null);
  const mode = picked && classes.includes(picked) ? picked : classes[0];
  return (
    <div className="ins">
      {classes.length > 1 && (
        <div className="ins-top">
          <PillSwitch
            label="Asset class"
            value={mode}
            onChange={setPicked}
            options={classes.map((k) => ({ key: k, label: MODE_LABELS[k] }))}
          />
          <p className="ins-hint">This portfolio holds more than one asset class. Pick one to see its charts.</p>
        </div>
      )}
      {mode === 'stocks' ? (
        <PortfolioReports portfolio={portfolio} />
      ) : (
        <AssetReports
          portfolio={portfolio}
          mode={mode}
          metalRates={metalRates}
          fundNavs={fundNavs}
          planNavs={planNavs}
          fx={fx}
        />
      )}
    </div>
  );
}
