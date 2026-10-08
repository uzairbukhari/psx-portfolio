'use client';

import { useMemo, useState } from 'react';
import { applyFinqalabPlan, finqalabPlanIsNoop, planFinqalabImport, type FinqalabResolution, type FinqalabTrade } from './finqalab-import';
import { buildTodos, dateRangeLabel, dayMonth, fmtRs, footerStatus, openTodos, plural } from '@/lib/import-review-format';
import type { Portfolio } from '@/lib/portfolio';
import { useCompanyStates } from './use-company-lookup';
import {
  DecisionCompare, FilterChips, HoldingsAfter, MethodChip, ReviewRows, ReviewSection, ReviewShell, ReviewSidebar, RowSwitch, SplitSection, StaleBanner, StatTiles,
  type ReviewRowData,
} from './import-review-parts';
import { useSplitReview } from './use-split-review';

const STATUS_LABEL = { new: 'New', duplicate: 'Already recorded', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision' } as const;

export function FinqalabImportDialog({
  rows, fileName, destination, portfolio, revision, busy, onCancel, onCommit, onViewActivity,
}: {
  rows: FinqalabTrade[];
  fileName: string;
  destination: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
  onViewActivity?: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, FinqalabResolution>>({});
  const [filter, setFilter] = useState('all');
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const stale = revision !== reviewedRevision;

  const activity = useMemo(() => rows.map((r) => ({ ticker: r.ticker, date: r.date, price: r.price })), [rows]);
  const splitReview = useSplitReview(portfolio, activity);
  const plan = useMemo(
    () => planFinqalabImport(portfolio, rows, { resolutions, splits: splitReview.splits }),
    [portfolio, rows, resolutions, splitReview.splits],
  );
  const companyState = useCompanyStates(plan.newCompanies);
  const noop = finqalabPlanIsNoop(plan);
  const resolve = (id: string, patch: FinqalabResolution) => setResolutions((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const nameOf = (ticker: string) => portfolio.companies.find((c) => c.ticker === ticker)?.name;

  const undecided = plan.rows.filter((r) => r.status === 'ambiguous' && !resolutions[r.externalId]?.action);
  const todos = buildTodos({
    decisions: plan.rows.some((r) => r.status === 'ambiguous')
      ? [{ key: 'decide', text: undecided.length ? `Decide ${undecided.length} ${plural(undecided.length, 'trade')} that may already be in your ledger` : 'Possible duplicates decided', done: undecided.length === 0, anchor: undecided[0] ? `rv-${undecided[0].externalId}` : undefined }]
      : [],
    blockers: plan.blockers,
    covered: /need your decision/,
  });
  const open = openTodos(todos);
  const canImport = !stale && open === 0 && !noop && !busy;

  async function commit() {
    const next = applyFinqalabPlan(portfolio, plan);
    const parts = [
      `${plan.counts.imported} Finqalab ${plural(plan.counts.imported, 'trade')} imported`,
      plan.splits.length ? `${plan.splits.length} stock ${plural(plan.splits.length, 'split')} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved ${plural(plan.newCompanies.length, 'company', 'companies')}` : '',
    ].filter(Boolean);
    const message = parts.join('. ') + '.';
    await onCommit(next, message);
    return message;
  }

  const data: ReviewRowData[] = plan.rows.map((row) => {
    const t = row.trade;
    const decided = resolutions[row.externalId]?.action;
    const group = row.status === 'new' ? 'new' : row.status === 'ambiguous' ? 'decide' : row.status === 'duplicate' ? 'recorded' : 'skipped';
    const toggle = <RowSwitch on={row.action === 'import'} label={`Import ${t.ticker} ${t.kind} on ${dayMonth(t.date)}`} onChange={(on) => resolve(row.externalId, { action: on ? 'import' : 'skip' })} />;
    return {
      key: row.externalId, anchor: `rv-${row.externalId}`, date: t.date, side: t.kind, ticker: t.ticker, name: nameOf(t.ticker),
      tag: plan.newCompanies.includes(t.ticker) ? 'NEW' : undefined, qty: t.shares, price: t.price, fees: t.fees, value: t.shares * t.price,
      notes: [`Trade No. ${t.tradeNo}`],
      status: { label: STATUS_LABEL[row.status], tone: row.status === 'new' ? 'new' : row.status === 'ambiguous' ? 'amb' : row.status === 'duplicate' ? 'dup' : 'off' },
      group, dim: row.status === 'duplicate' || (row.status !== 'ambiguous' && row.action === 'skip'), attention: row.status === 'ambiguous' && !decided,
      control: row.status === 'duplicate' ? <span className="muted">Skipped</span> : row.status === 'ambiguous' ? null : toggle,
      extra: row.status === 'ambiguous' ? (
        <DecisionCompare
          statement={<>{dayMonth(t.date)} · {t.kind} {t.shares} @ {t.price}</>}
          ledger={row.candidates.map((c) => <div key={c.id}>{c.reason}</div>)}
          value={decided} onChange={(v) => resolve(row.externalId, { action: v })} />
      ) : undefined,
    };
  });
  const count = (g: ReviewRowData['group']) => data.filter((r) => r.group === g).length;
  const options = [
    { key: 'all', label: 'All', count: data.length },
    { key: 'new', label: 'New', count: count('new') },
    ...(count('decide') ? [{ key: 'decide', label: 'Needs decision', count: count('decide') }] : []),
    ...(count('recorded') ? [{ key: 'recorded', label: 'Already recorded', count: count('recorded') }] : []),
    ...(count('skipped') ? [{ key: 'skipped', label: 'Removed earlier', count: count('skipped') }] : []),
  ];
  const imported = plan.rows.filter((r) => r.action === 'import');
  const buys = imported.filter((r) => r.trade.kind === 'buy');
  const sells = imported.filter((r) => r.trade.kind === 'sell');
  const sum = (list: typeof imported) => list.reduce((a, r) => a + r.trade.shares * r.trade.price, 0);
  const sidebar = (
    <ReviewSidebar
      big={`${plan.counts.imported} ${plural(plan.counts.imported, 'trade')}`}
      sub={`${buys.length} ${plural(buys.length, 'buy')}, ${sells.length} ${plural(sells.length, 'sell')} into ${destination}`}
      lines={[
        ...(buys.length ? [['Bought for', fmtRs(sum(buys))] as [string, string]] : []),
        ...(sells.length ? [['Sold for', fmtRs(sum(sells))] as [string, string]] : []),
        ...(plan.newCompanies.length ? [['New companies', plan.newCompanies.join(', ')] as [string, string]] : []),
        ...(plan.splits.length ? [['Stock splits', String(plan.splits.length)] as [string, string]] : []),
        ['Already recorded, skipped', String(plan.counts.duplicate)],
      ]}
      todos={todos} warnings={plan.warnings}
      privacy="Nothing is saved until you press Import. The report was read in your browser; it was not uploaded."
    />
  );
  return (
    <ReviewShell
      title="Finqalab trades" destination={destination}
      subtitle={<>{fileName} · {dateRangeLabel([plan.range.from, plan.range.to])}</>}
      chips={<MethodChip method="browser" />}
      sidebar={sidebar} footer={footerStatus({ open, noop, stale })}
      busy={busy} onCancel={onCancel} onViewActivity={onViewActivity}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} ${plural(plan.counts.imported, 'trade')}`}
      primaryDisabled={!canImport} onPrimary={commit}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      {noop && <div className="ir-banner" aria-live="polite">Nothing new: every row is already in your ledger. Re-importing changes nothing.</div>}
      <StatTiles active={filter} onFilter={setFilter} tiles={[
        { key: 'new', value: count('new'), label: plural(count('new'), 'new trade'), filter: 'new' },
        { key: 'rec', value: count('recorded'), label: 'already recorded', filter: 'recorded' },
        { key: 'dec', value: open, label: 'to decide', warn: true, filter: 'decide' },
        { key: 'sp', value: plan.splits.length, label: plural(plan.splits.length, 'split') + ' to add' },
      ]} />

      <ReviewSection id="rv-sec-trades" step={1} title="Report trades" state={undecided.length ? 'todo' : 'done'} meta={`${data.length} in the report · ${plan.counts.imported} selected`}>
        <FilterChips options={options} value={filter} onChange={setFilter} />
        <ReviewRows rows={data.filter((r) => filter === 'all' || r.group === filter)} empty={data.length ? 'Nothing in this view.' : 'No trades in this report.'} />
      </ReviewSection>

      <SplitSection review={splitReview} />

      <ReviewSection step={2} title="Holdings after import" state="done">
        <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
      </ReviewSection>
    </ReviewShell>
  );
}
