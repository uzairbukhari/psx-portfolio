'use client';
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { applyBrokerImport, planBrokerImport, type BrokerStatement } from '@/lib/broker-import';
import {
  brokerHoldingChanges, buildTodos, dateRangeLabel, dayMonth, fmtPrice, fmtQty, fmtRs, footerStatus, openTodos, plural, type ReviewTodo,
} from '@/lib/import-review-format';
import type { Portfolio } from '@/lib/portfolio';
import {
  DecisionCompare, FilterChips, HoldingsAfter, MethodChip, ReviewRows, ReviewSection, ReviewShell, ReviewSidebar, RowSwitch, StaleBanner, StatTiles,
  type ReviewRowData,
} from './import-review-parts';

export function BrokerImportDialog({ statement, fileName, destination, portfolio, revision, busy, method, mappingReady, onCancel, onCommit, onViewActivity }: {
  statement: BrokerStatement; fileName: string; destination: string; portfolio: Portfolio; revision: number; busy: boolean;
  method: 'ai' | 'saved' | 'local'; mappingReady: boolean;
  onCancel: () => void; onCommit: (next: Portfolio, message: string, broker: string) => Promise<void>; onViewActivity?: () => void;
}) {
  const [account, setAccount] = useState(statement.account);
  const [broker, setBroker] = useState(statement.broker);
  const [actions, setActions] = useState<Record<string, 'import' | 'skip'>>({});
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const [filter, setFilter] = useState('all');
  const stale = reviewedRevision !== revision;
  const effective = useMemo(() => ({ ...statement, account, broker }), [statement, account, broker]);
  const plan = useMemo(() => planBrokerImport(portfolio, effective, actions, assignIds), [portfolio, effective, actions, assignIds]);
  const unassigned = portfolio.trades.filter((t) => !t.voided && !t.accountId && statement.holdings.some((h) => h.ticker === t.ticker));
  const legacyLeft = unassigned.filter((t) => !assignIds.includes(t.id)).length;
  const counts = { trades: plan.rows.filter((r) => r.action === 'import').length, adjustments: plan.adjustments.filter((a) => a.action === 'import').length };
  const nothing = counts.trades + counts.adjustments + assignIds.length === 0;
  const setAction = (key: string, action: 'import' | 'skip') => setActions((a) => ({ ...a, [key]: action }));
  const nameOf = (ticker: string) => portfolio.companies.find((c) => c.ticker === ticker)?.name;

  const undecidedTrades = plan.rows.filter((r) => r.status === 'ambiguous' && !actions[r.key]);
  const undecidedAdjustments = plan.adjustments.filter((a) => !actions[a.key]);
  const todos: ReviewTodo[] = buildTodos({
    decisions: [
      ...(!account.trim() || !broker.trim() ? [{ key: 'names', text: 'Enter the broker name and an account label', done: false, anchor: 'rv-sec-account' }] : []),
      ...(unassigned.length ? [{ key: 'assign', text: legacyLeft ? 'Assign the older entries for these companies to this account' : 'Older entries assigned', done: legacyLeft === 0, anchor: 'rv-sec-account' }] : []),
      ...(plan.rows.some((r) => r.status === 'ambiguous')
        ? [{ key: 'trades', text: undecidedTrades.length ? `Decide ${undecidedTrades.length} ${plural(undecidedTrades.length, 'trade')} that may already be in your ledger` : 'Possible duplicates decided', done: undecidedTrades.length === 0, anchor: undecidedTrades[0] ? `rv-${undecidedTrades[0].key}` : undefined }]
        : []),
      ...(plan.adjustments.length
        ? [{ key: 'adjustments', text: undecidedAdjustments.length ? `Choose what to do about ${undecidedAdjustments.length} balance ${plural(undecidedAdjustments.length, 'difference')}` : 'Balance differences decided', done: undecidedAdjustments.length === 0, anchor: undecidedAdjustments[0] ? `rv-${undecidedAdjustments[0].key}` : undefined }]
        : []),
    ],
    blockers: plan.blockers,
    covered: /choose Import or Skip|without a broker account/,
  });
  const open = openTodos(todos);
  const canImport = !stale && !busy && open === 0 && !nothing;

  async function commit() {
    const next = applyBrokerImport(portfolio, effective, plan);
    const message = `${counts.trades} ${plural(counts.trades, 'trade')} and ${counts.adjustments} holding ${plural(counts.adjustments, 'adjustment')} imported from ${effective.broker}.`;
    await onCommit(next, message, effective.broker);
    return message;
  }

  const rows: ReviewRowData[] = plan.rows.map((r) => {
    const t = r.trade;
    const decided = actions[r.key];
    const earlier = portfolio.trades.find((x) => !x.voided && x.ticker === t.ticker && x.date === t.date && x.kind === t.side && x.shares === t.shares)
      ?? portfolio.trades.find((x) => x.source === 'broker' && x.externalId === r.key);
    const group = r.status === 'new' ? 'new' : r.status === 'ambiguous' ? 'decide' : r.status === 'duplicate' ? 'recorded' : 'skipped';
    const label = { new: 'New', duplicate: 'Already recorded', ambiguous: 'Needs decision', removed: 'Removed earlier' }[r.status];
    return {
      key: r.key, anchor: `rv-${r.key}`, date: t.date, side: t.side, ticker: t.ticker, name: nameOf(t.ticker),
      tag: plan.newCompanies.includes(t.ticker) ? 'NEW' : undefined, qty: t.shares, price: t.price, fees: t.fees, value: t.shares * t.price,
      status: { label, tone: r.status === 'new' ? 'new' : r.status === 'ambiguous' ? 'amb' : r.status === 'duplicate' ? 'dup' : 'off' },
      group, dim: r.status === 'duplicate' || (r.status !== 'ambiguous' && r.action === 'skip'), attention: r.status === 'ambiguous' && !decided,
      control: r.status === 'duplicate' ? <span className="muted">Skipped</span>
        : r.status === 'ambiguous' ? null
        : <RowSwitch on={r.action === 'import'} label={`Import ${t.ticker} ${t.side} on ${dayMonth(t.date)}`} onChange={(on) => setAction(r.key, on ? 'import' : 'skip')} />,
      extra: r.status === 'ambiguous' ? (
        <DecisionCompare
          statement={<>{dayMonth(t.date)} · {t.side} {fmtQty(t.shares)} @ {fmtPrice(t.price)}</>}
          ledger={earlier ? <>{dayMonth(earlier.date)} · {earlier.kind} {fmtQty(earlier.shares)}{earlier.price ? ` @ ${fmtPrice(earlier.price)}` : ''}{earlier.source === 'broker' ? ' (imported earlier with different details)' : ' (entered by hand)'}</> : 'A similar entry'}
          value={decided}
          onChange={(v) => setAction(r.key, v)}
        />
      ) : undefined,
    };
  });
  const shown = rows.filter((r) => filter === 'all' || r.group === filter);
  const count = (g: ReviewRowData['group']) => rows.filter((r) => r.group === g).length;
  const options = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'new', label: 'New', count: count('new') },
    ...(count('decide') ? [{ key: 'decide', label: 'Needs decision', count: count('decide') }] : []),
    ...(count('recorded') ? [{ key: 'recorded', label: 'Already recorded', count: count('recorded') }] : []),
    ...(count('skipped') ? [{ key: 'skipped', label: 'Removed earlier', count: count('skipped') }] : []),
  ];
  const imported = plan.rows.filter((r) => r.action === 'import');
  const buys = imported.filter((r) => r.trade.side === 'buy');
  const sells = imported.filter((r) => r.trade.side === 'sell');
  const sum = (list: typeof imported) => list.reduce((a, r) => a + r.trade.shares * r.trade.price, 0);
  const warnings = [
    ...statement.warnings,
    ...(plan.newCompanies.length ? [`${plan.newCompanies.join(', ')} ${plan.newCompanies.length === 1 ? 'is' : 'are'} new to Sipwise and will stay unapproved, with a 0% target, until you review ${plan.newCompanies.length === 1 ? 'it' : 'them'}.`] : []),
    ...(method === 'ai' ? [mappingReady ? 'After you confirm this import, this table layout can be read on your device next time if the format matches.' : 'This layout could not be made into a safe local parser. A different file will need AI extraction again; an identical imported file will be recognised without AI.'] : []),
  ];
  const sidebar = (
    <ReviewSidebar
      big={`${counts.trades} ${plural(counts.trades, 'trade')}`}
      sub={`${buys.length} ${plural(buys.length, 'buy')}, ${sells.length} ${plural(sells.length, 'sell')} into ${destination}`}
      lines={[
        ...(buys.length ? [['Bought for', fmtRs(sum(buys))] as [string, string]] : []),
        ...(sells.length ? [['Sold for', fmtRs(sum(sells))] as [string, string]] : []),
        ...(plan.newCompanies.length ? [['New companies', plan.newCompanies.join(', ')] as [string, string]] : []),
        ...(counts.adjustments ? [['Balance adjustments', String(counts.adjustments)] as [string, string]] : []),
        ...(assignIds.length ? [['Older entries assigned', String(assignIds.length)] as [string, string]] : []),
        ['Already recorded, skipped', String(count('recorded'))],
      ]}
      todos={todos} warnings={warnings}
      privacy={method === 'ai' ? 'Nothing is saved until you press Import. The account label is saved only in your encrypted portfolio.' : 'Nothing is saved until you press Import. Name, address and bank details were not read.'}
    />
  );
  const range = dateRangeLabel([...statement.trades.map((t) => t.date), ...statement.holdings.map((h) => h.asOf)]);
  const tradesOpen = undecidedTrades.length > 0;
  return (
    <ReviewShell
      title={`${effective.broker} statement`} destination={destination}
      subtitle={<>{fileName}{range ? ` · ${range}` : ''}</>}
      chips={<MethodChip method={method} />}
      sidebar={sidebar} footer={footerStatus({ open, noop: nothing, stale })}
      busy={busy} onCancel={onCancel} onViewActivity={onViewActivity}
      primaryLabel={nothing ? 'Nothing to import' : counts.trades ? `Import ${counts.trades} ${plural(counts.trades, 'trade')}` : 'Save changes'}
      primaryDisabled={!canImport} onPrimary={commit}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      <StatTiles active={filter} onFilter={setFilter} tiles={[
        { key: 'new', value: count('new'), label: plural(count('new'), 'new trade'), filter: 'new' },
        { key: 'rec', value: count('recorded'), label: 'already recorded', filter: 'recorded' },
        { key: 'dec', value: open, label: 'to decide', warn: true, filter: 'decide' },
        { key: 'co', value: plan.newCompanies.length, label: plural(plan.newCompanies.length, 'new company', 'new companies') },
      ]} />

      <ReviewSection id="rv-sec-account" step={1} title="Broker account" meta="Used to match this account next time"
        state={!account.trim() || !broker.trim() || legacyLeft > 0 ? 'todo' : 'done'}>
        <div className="rv-acct">
          <label className="rv-field">Broker<input value={broker} maxLength={80} onChange={(e) => setBroker(e.target.value)} /></label>
          <label className="rv-field">Broker account label<input value={account} maxLength={60} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. JS main" /></label>
          <p className="rv-hint">Use a different label for each account at the same broker. The label is saved only in your encrypted portfolio.</p>
        </div>
        {unassigned.length > 0 && legacyLeft > 0 && (
          <div className="rv-callout">
            <h3>Do these older entries belong to this account?</h3>
            <p>These entries are for companies on this statement but have no broker account yet. Assign them here so the statement’s balances can be checked. Only the account label changes, not the trade.</p>
            <div className="rv-picks">
              {unassigned.map((t) => {
                const on = assignIds.includes(t.id);
                return (
                  <button key={t.id} type="button" className="rv-pick" aria-pressed={on}
                    onClick={() => setAssignIds((ids) => (on ? ids.filter((id) => id !== t.id) : [...ids, t.id]))}>
                    <span className="box">{on && <Check size={11} aria-hidden />}</span>
                    <b>{t.ticker}</b> {fmtQty(t.shares)} shares <span className="muted">{t.kind}, {dayMonth(t.date)}</span>
                  </button>
                );
              })}
            </div>
            <div className="rv-pick-actions"><button type="button" className="rv-link" onClick={() => setAssignIds(unassigned.map((t) => t.id))}>Select all</button></div>
          </div>
        )}
      </ReviewSection>

      <ReviewSection id="rv-sec-trades" step={2} title="Trades" state={tradesOpen ? 'todo' : 'done'}
        meta={`${rows.length} on the statement · ${counts.trades} selected`}
        right={count('new') > 0 && imported.length < count('new') ? <button type="button" className="rv-link" onClick={() => setActions((a) => ({ ...a, ...Object.fromEntries(plan.rows.filter((r) => r.status === 'new').map((r) => [r.key, 'import' as const])) }))}>Turn all new on</button> : null}>
        <FilterChips options={options} value={filter} onChange={setFilter} />
        <ReviewRows rows={shown} empty={rows.length ? 'Nothing in this view.' : 'No trades in this statement.'} />
      </ReviewSection>

      <ReviewSection id="rv-sec-holdings" step={3} title="Holdings after import" state={undecidedAdjustments.length ? 'todo' : 'done'}
        meta={plan.adjustments.length ? 'The statement’s balances differ from your ledger' : undefined}>
        {plan.adjustments.length > 0 && (
          <div className="rv-pad">
            <p className="muted">An accepted difference becomes an auditable adjustment with unknown cost, not a purchase or sale.</p>
            {plan.adjustments.map((a) => (
              <div key={a.key} id={`rv-${a.key}`} className="ir-assumed">
                <span><b>{a.ticker}</b>: reported {fmtQty(a.reported)} shares as of {dayMonth(a.asOf)}, ledger has {fmtQty(a.before)} ({a.difference > 0 ? '+' : ''}{fmtQty(a.difference)})</span>
                <DecisionCompare
                  statement={<>{fmtQty(a.reported)} shares</>} ledger={<>{fmtQty(a.before)} shares recorded</>}
                  value={actions[a.key]} onChange={(v) => setAction(a.key, v)} skipLabel="Leave as is" importLabel="Apply adjustment" />
              </div>
            ))}
          </div>
        )}
        <HoldingsAfter changes={brokerHoldingChanges(portfolio, plan)} newCompanies={plan.newCompanies} />
      </ReviewSection>
    </ReviewShell>
  );
}
