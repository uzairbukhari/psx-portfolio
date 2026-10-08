'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IpoOffersResponse } from '@/lib/api-types';
import { applyIpoListPlan, ipoPlanIsNoop, planIpoListImport, ipoOutcome, type IpoAllotment, type IpoResolution, type IpoRowStatus } from '@/lib/ipo-list-import';
import type { IpoLookup } from '@/lib/ipo-offers';
import type { Portfolio } from '@/lib/portfolio';
import { readJson } from '@/lib/safe-json';
import { useCompanyStates } from './use-company-lookup';
import { buildTodos, dateRangeLabel, fmtRs, footerStatus, openTodos, plural } from '@/lib/import-review-format';
import {
  DecisionCompare, FilterChips, HoldingsAfter, MethodChip, ReviewRows, ReviewSection, ReviewShell, ReviewSidebar, RowSwitch, SplitSection, StaleBanner, StatTiles,
  type ReviewRowData,
} from './import-review-parts';
import { useSplitReview } from './use-split-review';

const STATUS_LABEL: Record<IpoRowStatus, string> = {
  new: 'Allotted', duplicate: 'Already recorded', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision',
  'not-allotted': 'Not allotted', pending: 'Not final yet',
};

export function IpoImportDialog({
  items, fileName, destination, portfolio, revision, busy, onCancel, onCommit, onViewActivity,
}: {
  items: IpoAllotment[];
  fileName: string;
  destination: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
  onViewActivity?: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, IpoResolution>>({});
  const [ipo, setIpo] = useState<Record<string, IpoLookup>>({});
  const [filter, setFilter] = useState('all');
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const stale = revision !== reviewedRevision;

  // Official offer prices and allotment dates, where we hold hand-checked evidence (tickers only leave the device).
  const allottedTickers = useMemo(() => [...new Set(items.filter((i) => ipoOutcome(i) === 'allotted').map((i) => i.ticker))].sort(), [items]);
  useEffect(() => {
    let live = true;
    for (let i = 0; i < allottedTickers.length; i += 5) {
      void fetch(`/api/ipo-offers?tickers=${allottedTickers.slice(i, i + 5).join(',')}`)
        .then((response) => (response.ok ? (readJson(response) as Promise<IpoOffersResponse>) : null))
        .then((data) => { if (live && data) setIpo((current) => ({ ...current, ...Object.fromEntries(data.lookups.map((l) => [l.ticker, l])) })); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [allottedTickers]);

  const activity = useMemo(() => items.filter((i) => ipoOutcome(i) === 'allotted').map((i) => ({ ticker: i.ticker, date: i.endDate })), [items]);
  const splitReview = useSplitReview(portfolio, activity);
  const plan = useMemo(
    () => planIpoListImport(portfolio, items, { resolutions, ipo, splits: splitReview.splits }),
    [portfolio, items, resolutions, ipo, splitReview.splits],
  );
  const companyState = useCompanyStates(plan.newCompanies);
  const noop = ipoPlanIsNoop(plan);
  const resolve = (id: string, patch: IpoResolution) => setResolutions((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  async function commit() {
    const next = applyIpoListPlan(portfolio, plan);
    const superseded = plan.rows.reduce((n, r) => n + r.supersedes.length, 0);
    const parts = [
      `${plan.counts.imported} IPO allotment${plan.counts.imported === 1 ? '' : 's'} imported`,
      superseded ? `${superseded} assumed acquisition${superseded === 1 ? '' : 's'} replaced by the real allotment` : '',
      plan.splits.length ? `${plan.splits.length} stock split${plan.splits.length === 1 ? '' : 's'} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved compan${plan.newCompanies.length === 1 ? 'y' : 'ies'}` : '',
    ].filter(Boolean);
    const message = parts.join('. ') + '.';
    await onCommit(next, message);
    return message;
  }

  const undecided = plan.rows.filter((r) => r.status === 'ambiguous' && !resolutions[r.externalId]?.action);
  const todos = buildTodos({
    decisions: plan.rows.some((r) => r.status === 'ambiguous')
      ? [{ key: 'decide', text: undecided.length ? `Decide ${undecided.length} ${plural(undecided.length, 'allotment')} that may already be in your ledger` : 'Possible duplicates decided', done: undecided.length === 0, anchor: undecided[0] ? `rv-${undecided[0].externalId}` : undefined }]
      : [],
    blockers: plan.blockers,
    covered: /need your decision/,
  });
  const open = openTodos(todos);
  const canImport = !stale && open === 0 && !noop && !busy;

  const data: ReviewRowData[] = plan.rows.map((row) => {
    const editable = row.status === 'new' || row.status === 'ambiguous' || row.status === 'previously-removed';
    const decided = resolutions[row.externalId]?.action;
    const group = row.status === 'new' ? 'new' : row.status === 'ambiguous' ? 'decide' : row.status === 'duplicate' ? 'recorded' : 'skipped';
    const refund = row.item.refund ? ` · refund ${fmtRs(row.item.refund)}` : '';
    return {
      key: row.externalId, anchor: `rv-${row.externalId}`, date: editable ? row.date : row.item.endDate, side: 'buy', sideLabel: 'IPO', ticker: row.item.ticker,
      name: `${row.item.name}${row.item.offerType ? ` · ${row.item.offerType}` : ''}`, tag: plan.newCompanies.includes(row.item.ticker) ? 'NEW' : undefined,
      qty: editable ? row.shares : row.item.allotted, price: editable && row.price > 0 ? row.price : null,
      priceNote: `applied ${row.item.applied}${refund}`, value: row.item.amountPaid - (row.item.refund ?? 0),
      notes: [
        ...row.flags,
        ...row.candidates.map((c) => c.reason),
        ...(row.supersedes.length ? [`Replaces ${row.supersedes.map((s) => `an assumed acquisition of ${s.shares}`).join(', ')} from an earlier import.`] : []),
      ],
      status: { label: STATUS_LABEL[row.status], tone: row.status === 'new' ? 'new' : row.status === 'ambiguous' ? 'amb' : row.status === 'duplicate' ? 'dup' : 'off' },
      group, dim: row.status !== 'ambiguous' && row.action !== 'import', attention: row.status === 'ambiguous' && !decided,
      control: row.status === 'ambiguous' ? null
        : row.status === 'new' || row.status === 'previously-removed'
          ? <RowSwitch on={row.action === 'import'} label={`Import ${row.item.ticker} allotment`} onChange={(on) => resolve(row.externalId, { action: on ? 'import' : 'skip' })} />
          : <span className="muted">Skipped</span>,
      extra: (
        <>
          {editable && (
            <div className="rv-extra">
              <label>Allotted shares
                <input type="number" min="1" step="1" aria-label={`Allotted shares for ${row.item.ticker}`} value={row.shares} onChange={(e) => resolve(row.externalId, { shares: Number(e.target.value) })} />
              </label>
              <label>Allotment date
                <input type="date" aria-label={`Allotment date for ${row.item.ticker}`} value={row.date} onChange={(e) => resolve(row.externalId, { date: e.target.value })} />
              </label>
              {row.dateInferred && <small>This is the subscription end date; edit it if you know the allotment day.</small>}
            </div>
          )}
          {row.status === 'ambiguous' && (
            <DecisionCompare
              statement={<>{row.item.ticker} · {row.shares} shares{row.price > 0 ? ` @ ${row.price.toFixed(2)}` : ''}</>}
              ledger={row.candidates.map((c) => <div key={c.id}>{c.reason}</div>)}
              value={decided} onChange={(v) => resolve(row.externalId, { action: v })}
              skipLabel="Same purchase, skip" importLabel="Different, import" />
          )}
        </>
      ),
    };
  });
  const count = (g: ReviewRowData['group']) => data.filter((r) => r.group === g).length;
  const options = [
    { key: 'all', label: 'All', count: data.length },
    { key: 'new', label: 'Allotted', count: count('new') },
    ...(count('decide') ? [{ key: 'decide', label: 'Needs decision', count: count('decide') }] : []),
    ...(count('recorded') ? [{ key: 'recorded', label: 'Already recorded', count: count('recorded') }] : []),
    ...(count('skipped') ? [{ key: 'skipped', label: 'Not allotted or not final', count: count('skipped') }] : []),
  ];
  const importedRows = plan.rows.filter((r) => r.action === 'import');
  const paid = importedRows.reduce((a, r) => a + r.item.amountPaid - (r.item.refund ?? 0), 0);
  const sidebar = (
    <ReviewSidebar
      big={`${plan.counts.imported} ${plural(plan.counts.imported, 'allotment')}`}
      sub={`IPO shares into ${destination}`}
      lines={[
        ...(importedRows.length ? [['Paid, after refunds', fmtRs(paid)] as [string, string]] : []),
        ...(plan.newCompanies.length ? [['New companies', plan.newCompanies.join(', ')] as [string, string]] : []),
        ...(plan.splits.length ? [['Stock splits', String(plan.splits.length)] as [string, string]] : []),
        ['Already recorded, skipped', String(plan.counts.duplicate)],
        ...(plan.counts.skipped ? [['Not allotted or not final', String(plan.counts.skipped)] as [string, string]] : []),
      ]}
      todos={todos} warnings={plan.warnings}
      privacy="Nothing is saved until you press Import. Only shares you were actually allotted are added, at the amount you paid after any refund."
    />
  );
  return (
    <ReviewShell
      title="IPO allotments" destination={destination}
      subtitle={<>{fileName} · {dateRangeLabel(items.map((i) => i.endDate))}</>}
      chips={<MethodChip method="browser" />}
      sidebar={sidebar} footer={footerStatus({ open, noop, stale })}
      busy={busy} onCancel={onCancel} onViewActivity={onViewActivity}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} ${plural(plan.counts.imported, 'allotment')}`}
      primaryDisabled={!canImport} onPrimary={commit}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      {noop && <div className="ir-banner" aria-live="polite">Nothing new: every allotment is already in your ledger. Re-importing changes nothing.</div>}
      <StatTiles active={filter} onFilter={setFilter} tiles={[
        { key: 'new', value: count('new'), label: 'allotted', filter: 'new' },
        { key: 'rec', value: count('recorded'), label: 'already recorded', filter: 'recorded' },
        { key: 'dec', value: open, label: 'to decide', warn: true, filter: 'decide' },
        { key: 'skip', value: count('skipped'), label: 'not allotted or not final', filter: 'skipped' },
      ]} />

      <ReviewSection id="rv-sec-trades" step={1} title="Subscriptions" state={undecided.length ? 'todo' : 'done'} meta={`${items.length} in the file · ${plan.counts.imported} selected`}>
        <FilterChips options={options} value={filter} onChange={setFilter} />
        <ReviewRows rows={data.filter((r) => filter === 'all' || r.group === filter)} empty={data.length ? 'Nothing in this view.' : 'No subscriptions in this file.'} />
      </ReviewSection>

      <SplitSection review={splitReview} />

      <ReviewSection step={2} title="Holdings after import" state="done">
        <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
      </ReviewSection>
    </ReviewShell>
  );
}
