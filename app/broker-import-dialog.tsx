'use client';
import { useMemo, useState } from 'react';
import { applyBrokerImport, planBrokerImport, type BrokerStatement } from '@/lib/broker-import';
import { holdings, type Portfolio } from '@/lib/portfolio';
import { ReviewShell, StaleBanner } from './import-review-parts';

export function BrokerImportDialog({ statement, fileName, portfolio, revision, busy, method, mappingReady, onCancel, onCommit }: {
  statement: BrokerStatement; fileName: string; portfolio: Portfolio; revision: number; busy: boolean;
  method: 'ai' | 'saved' | 'local'; mappingReady: boolean;
  onCancel: () => void; onCommit: (next: Portfolio, message: string, broker: string) => Promise<void>;
}) {
  const [account, setAccount] = useState(statement.account);
  const [broker, setBroker] = useState(statement.broker);
  const [actions, setActions] = useState<Record<string, 'import' | 'skip'>>({});
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const effective = useMemo(() => ({ ...statement, account, broker }), [statement, account, broker]);
  const plan = useMemo(() => planBrokerImport(portfolio, effective, actions, assignIds), [portfolio, effective, actions, assignIds]);
  const unassigned = portfolio.trades.filter((t) => !t.voided && !t.accountId && statement.holdings.some((h) => h.ticker === t.ticker));
  const counts = { trades: plan.rows.filter((r) => r.action === 'import').length, adjustments: plan.adjustments.filter((a) => a.action === 'import').length };
  const canImport = reviewedRevision === revision && !busy && !!account.trim() && !!broker.trim() && !plan.blockers.length && counts.trades + counts.adjustments + assignIds.length > 0;
  const setAction = (key: string, action: 'import' | 'skip') => setActions((a) => ({ ...a, [key]: action }));
  async function commit() {
    const next = applyBrokerImport(portfolio, effective, plan);
    await onCommit(next, `${counts.trades} trades and ${counts.adjustments} holding adjustments imported from ${effective.broker}.`, effective.broker);
  }
  return <ReviewShell title={`Review ${effective.broker} statement`} description={`${fileName}. Nothing is saved until you import. Check the account and every uncertain row.`}
    summary={<><span>{statement.trades.length} reported trades</span><span>{statement.holdings.length} reported holdings</span><span>{counts.trades} trades to import</span></>}
    busy={busy} onCancel={onCancel} primaryLabel="Import reviewed entries" primaryDisabled={!canImport} onPrimary={() => void commit()}>
    {reviewedRevision !== revision && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
    <p className="muted">{method === 'local' ? 'Read on your device using the built-in statement reader. No AI call was made; name, address and bank details were not read.' : method === 'saved' ? 'Read locally using a saved statement format. No AI call was made.' : mappingReady ? 'After you confirm this import, this table layout can be read locally next time if the format matches.' : 'This layout could not be made into a safe local parser. A different file will need AI extraction again; an identical imported file will be recognised without AI.'}</p>
    <label className="ir-toggle">Broker <input value={broker} maxLength={80} onChange={(e) => setBroker(e.target.value)} /></label>
    <label className="ir-toggle">Broker account label <input value={account} maxLength={60} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. JS main" /></label>
    <p className="muted">Use a different label for each account with the same broker. The label is saved only in your encrypted portfolio.</p>
    {statement.warnings.map((w, i) => <div className="ir-banner ir-warn" key={i}>{w}</div>)}
    {plan.blockers.map((b, i) => <div className="ir-banner ir-warn" key={i}>{b}</div>)}
    {unassigned.length > 0 && <><h3 className="ir-h">Assign older entries to this account</h3>
      <p className="muted">Select only entries that belong to this broker account. This changes their account label, not the trade itself.</p>
      {unassigned.map((t) => <label className="ir-toggle" key={t.id}><input type="checkbox" checked={assignIds.includes(t.id)} onChange={(e) => setAssignIds((ids) => e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id))} />{t.date} · {t.ticker} · {t.kind} · {t.shares} shares</label>)}
    </>}
    <h3 className="ir-h">Trades</h3>
    <div className="ir-table-wrap"><table className="ir-table"><thead><tr><th>Date</th><th>Side</th><th>Symbol</th><th>Shares</th><th>Price</th><th>Fees</th><th>Status</th><th>Decision</th></tr></thead><tbody>
      {plan.rows.map((r) => <tr key={r.key}><td>{r.trade.date}</td><td>{r.trade.side}</td><td>{r.trade.ticker}</td><td>{r.trade.shares}</td><td>{r.trade.price}</td><td>{r.trade.fees}</td><td>{r.status}</td><td>{r.status === 'duplicate' ? 'Already recorded' : <select aria-label={`Decision for ${r.trade.ticker} trade on ${r.trade.date}`} value={r.action} onChange={(e) => setAction(r.key, e.target.value as 'import' | 'skip')}><option value="import">Import</option><option value="skip">Skip</option></select>}</td></tr>)}
      {!plan.rows.length && <tr><td colSpan={8}>No trades in this statement.</td></tr>}
    </tbody></table></div>
    <h3 className="ir-h">Holdings reconciliation</h3>
    <p className="muted">Each row compares the reported balance with trades assigned to this broker account. Any accepted difference becomes an auditable adjustment with unknown cost, not a purchase or sale.</p>
    <div className="ir-table-wrap"><table className="ir-table"><thead><tr><th>As of</th><th>Symbol</th><th>Recorded</th><th>Reported</th><th>Difference</th><th>Decision</th></tr></thead><tbody>
      {plan.adjustments.map((a) => <tr key={a.key}><td>{a.asOf}</td><td>{a.ticker}</td><td>{a.before}</td><td>{a.reported}</td><td>{a.difference}</td><td><select aria-label={`Decision for ${a.ticker} holding adjustment`} value={a.action} onChange={(e) => setAction(a.key, e.target.value as 'import' | 'skip')}><option value="skip">Skip</option><option value="import">Apply adjustment</option></select></td></tr>)}
      {!plan.adjustments.length && <tr><td colSpan={6}>No balance differences found.</td></tr>}
    </tbody></table></div>
    {plan.newCompanies.length > 0 && <p className="ir-banner ir-warn">New symbols: {plan.newCompanies.join(', ')}. They will remain unapproved for allocation.</p>}
    <p className="muted">Current combined holdings: {holdings(portfolio).filter((h) => h.shares > 0).length} companies.</p>
  </ReviewShell>;
}
