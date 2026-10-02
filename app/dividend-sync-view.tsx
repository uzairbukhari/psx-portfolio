'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DividendRefreshResponse } from '@/lib/api-types';
import {
  approveSelectedAsReceived,
  earliestHoldingDate,
  isSelectable,
  planHistoricalDividends,
  type DividendCandidate,
} from '@/lib/dividend-history';
import { money, today, type Portfolio } from '@/lib/portfolio';
import { useConfirm } from '@/components/confirm-dialog';
import './import-review.css';

const OVERALL: Record<DividendRefreshResponse['overall'], { label: string; tone: 'ok' | 'bad' | 'wait' | '' }> = {
  idle: { label: 'Not fetched yet', tone: '' },
  queued: { label: 'Queued', tone: 'wait' },
  running: { label: 'Running', tone: 'wait' },
  completed: { label: 'Completed', tone: 'ok' },
  partial: { label: 'Partly complete', tone: 'wait' },
  failed: { label: 'Failed', tone: 'bad' },
};
const STATE_LABEL: Record<DividendCandidate['state'], string> = {
  eligible: 'New', convert: 'Expected → received', approved: 'Already received', recorded: 'Already recorded', voided: 'Voided by you', 'not-held': 'Not held at cutoff',
};

export function DividendSyncView({
  portfolio, revision, busy, onSave,
}: {
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onSave: (next: Portfolio, message: string) => Promise<void>;
}) {
  const { confirm, dialog } = useConfirm();
  const [from, setFrom] = useState(() => earliestHoldingDate(portfolio) ?? today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<DividendRefreshResponse | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [faceValues, setFaceValues] = useState<Record<string, number>>({});
  const [showAll, setShowAll] = useState(false);
  const poll = useRef(0);
  const loading = data === null && !error;

  const load = useCallback(async () => {
    const response = await fetch('/api/dividends/refresh');
    const body = (await response.json()) as DividendRefreshResponse & { error?: string };
    if (!response.ok) throw new Error(body.error);
    setData(body);
    return body;
  }, []);

  const stopPolling = useCallback(() => { poll.current++; }, []);
  useEffect(() => {
    let live = true;
    void fetch('/api/dividends/refresh')
      .then(async (response) => {
        const body = (await response.json()) as DividendRefreshResponse & { error?: string };
        if (!response.ok) throw new Error(body.error);
        if (live) setData(body);
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; stopPolling(); };
  }, [stopPolling]);

  // The ledger changed (another tab, an import, an approval): selections were made against the old one.
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current !== revision) {
      seenRevision.current = revision;
      if (selectedRef.current.size) setNote('Your portfolio changed, so the selection was cleared. Review the updated list.');
      setSelected(new Set());
      setConfirmed(new Set());
      void load().catch(() => {});
    }
  }, [revision, load]);

  async function refresh() {
    setError('');
    setNote('');
    const ticket = ++poll.current;
    try {
      const response = await fetch('/api/dividends/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = (await response.json()) as DividendRefreshResponse & { error?: string };
      if (!response.ok) throw new Error(body.error);
      setData(body);
      setNote(body.message ?? '');
      for (let i = 0; i < 200 && ticket === poll.current; i++) {
        const state = (await load()).overall;
        if (state !== 'queued' && state !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const plan = useMemo(
    () => (data ? planHistoricalDividends(portfolio, data.announcements, { from, to, faceValues }) : null),
    [portfolio, data, from, to, faceValues],
  );
  const rows = plan?.candidates.filter((c) => showAll || c.state === 'eligible' || c.state === 'convert') ?? [];
  const selectable = rows.filter((c) => isSelectable(c, confirmed));
  const picked = (plan?.candidates ?? []).filter((c) => selected.has(c.id) && isSelectable(c, confirmed));
  const total = picked.reduce((a, c) => a + (c.gross ?? 0), 0);
  const coverage = data?.states.filter((s) => s.state === 'completed' && s.coverageFrom).map((s) => s.coverageFrom!).sort() ?? [];
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const acknowledge = (key: string, on: boolean) => setConfirmed((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });

  async function approve() {
    if (!data || !picked.length) return;
    const ok = await confirm({
      title: `Approve ${picked.length} dividend${picked.length === 1 ? '' : 's'} as received?`,
      description: `Approving confirms that you received these dividends (about ${money(total)} gross in total). The amounts are calculated from your holdings and PSX's announced rate, not read from a bank or CDC statement. Payment dates stay unknown and no tax is recorded. A later CDC import will replace them with actual figures.`,
      confirmLabel: 'Approve as received',
    });
    if (!ok) return;
    const result = approveSelectedAsReceived(portfolio, data.announcements, {
      reviewed: picked.map((c) => ({ id: c.id, shares: c.shares, perShare: c.perShare!, gross: c.gross! })),
      faceValues, confirmed, from, to,
    });
    if (!result.ok) {
      setError(result.message);
      if (result.reason === 'stale') setSelected(new Set());
      return;
    }
    setError('');
    await onSave(result.portfolio, `${result.approved.length + result.converted.length} dividend${result.approved.length + result.converted.length === 1 ? '' : 's'} approved as received (${money(result.total)} gross).`);
    setSelected(new Set());
  }

  const status = data ? OVERALL[data.overall] : null;
  return (
    <div className="ds">
      {dialog}
      <p className="muted">
        Review cash dividends your holdings were entitled to, including sold positions. Eligibility comes from the book-closure range and the shares you held on each
        payout’s cutoff date (the last trade that settles before book closure: T+2 before 9 Feb 2026, T+1 after, skipping weekends and market holidays).
        Announcement dates alone do not decide it. Nothing is added until you approve it.
      </p>
      <div className="ir-controls">
        <label>Book closure from <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>to <input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="secondary compact" onClick={() => { setFrom(earliestHoldingDate(portfolio) ?? today()); setTo(today()); }}>Reset to full history</button>
        <button type="button" className="compact" disabled={busy || loading || data?.dispatchEnabled === false || data?.overall === 'queued' || data?.overall === 'running'} onClick={() => void refresh()}>
          Refresh PSX announcements
        </button>
      </div>
      <div className="ir-status" aria-live="polite">
        {status && <span>Announcement fetch: <span className={`ir-pill ${status.tone}`}>{status.label}</span></span>}
        {data && <span>{data.tickers.length} compan{data.tickers.length === 1 ? 'y' : 'ies'} with trade history</span>}
        {coverage[0] && <span>PSX returned announcements from {coverage[0]} onward; earlier payouts may be missing.</span>}
        {data?.disabledReason && <span className="ir-issue">{data.disabledReason} Showing announcements already cached by the daily scrape.</span>}
        {loading && <span>Loading…</span>}
      </div>
      {data && data.states.some((s) => s.state !== 'none') && (
        <details className="ir-warnings">
          <summary>Per-company fetch status</summary>
          <ul>
            {data.states.map((s) => (
              <li key={s.ticker}>
                <b>{s.ticker}</b>: {s.state === 'none' ? 'not fetched on demand (cached data only)' : s.state}
                {s.state === 'completed' && ` — ${s.rowsFound ?? 0} announcement${s.rowsFound === 1 ? '' : 's'}${s.rowsFound ? '' : ' (PSX lists none: a successful empty result)'}${s.completedAt ? `, ${s.completedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`}
                {s.state === 'failed' && ` — ${s.error ?? 'failed'}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data && data.overall !== 'completed' && data.overall !== 'idle' && (
        <div className="ir-banner ir-warn" aria-live="polite">
          {data.overall === 'partial' || data.overall === 'failed'
            ? 'Some companies could not be refreshed, so this list may be incomplete. Rows below come from the last saved announcements.'
            : 'Fetching… the list below uses the last saved announcements until it finishes.'}
        </div>
      )}
      {data && data.overall === 'idle' && (
        <div className="ir-banner" aria-live="polite">The list below uses announcements saved by the daily scrape. Refresh to fetch each company’s full PSX payout history; until then it is not a complete historical fetch.</div>
      )}
      {error && <div className="ir-banner ir-warn" role="alert">{error}</div>}
      {note && !error && <div className="ir-banner" aria-live="polite">{note}</div>}

      {plan?.corporateActions.length ? (
        <div className="ir-banner ir-warn" aria-live="polite">
          Possible unrecorded split or bonus: {plan.corporateActions.map((c) => `${c.ticker} (Rs ${c.from.price} → Rs ${c.to.price})`).join(', ')}. Rows for these need your confirmation.
        </div>
      ) : null}

      <label className="ir-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Also show rows already recorded, voided or not held</label>
      <div className="ir-table-wrap">
        <table className="ir-table" aria-label="Historical cash dividends">
          <thead>
            <tr><th><span className="sr-only">Select</span></th><th>Company</th><th>Payout</th><th>Book closure</th><th>Cutoff</th><th className="num">Shares</th><th className="num">Per share</th><th className="num">Gross</th><th>Status</th></tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={9} className="muted">{data ? 'No cash dividends to review in this range.' : 'Loading…'}</td></tr>}
            {rows.map((c) => {
              const actionable = c.state === 'eligible' || c.state === 'convert';
              const ok = isSelectable(c, confirmed);
              return (
                <tr key={c.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${c.announcement.ticker} ${c.announcement.bookClosureStart}`} disabled={!ok || busy} checked={selected.has(c.id) && ok} onChange={(e) => toggle(c.id, e.target.checked)} />
                  </td>
                  <td><b>{c.announcement.ticker}</b></td>
                  <td>{c.announcement.details}<small>{c.announcement.period || 'period not stated'} · announced {c.announcement.announcedOn}</small></td>
                  <td>{c.announcement.bookClosureStart}<small>to {c.announcement.bookClosureEnd}</small></td>
                  <td>{c.entitlementDate}<small>{c.settlement}{c.calendarCertain ? '' : ' · holidays unconfirmed'}</small></td>
                  <td className="num">{c.shares}</td>
                  <td className="num">{c.perShare === null ? '—' : c.perShare.toFixed(2)}</td>
                  <td className="num">{c.gross === null ? '—' : money(c.gross)}</td>
                  <td>
                    {STATE_LABEL[c.state]}
                    {actionable && c.issues.map((issue) => (
                      <small key={issue.kind} className="ir-issue">
                        {issue.message}
                        {issue.kind === 'face-value' ? (
                          <span className="ir-inline">
                            <input type="number" min="0.01" step="any" aria-label={`Face value for ${c.announcement.ticker}`} placeholder="Face value" onChange={(e) => { const v = Number(e.target.value); setFaceValues((f) => { const n = { ...f }; if (v > 0) n[c.announcement.ticker] = v; else delete n[c.announcement.ticker]; return n; }); }} />
                            <button type="button" className="secondary compact" onClick={() => setFaceValues((f) => ({ ...f, [c.announcement.ticker]: 10 }))}>Use Rs 10</button>
                          </span>
                        ) : issue.severity === 'confirm' ? (
                          <label className="ir-toggle"><input type="checkbox" checked={confirmed.has(issue.kind === 'corporate-action' ? `${c.announcement.ticker}|${issue.kind}` : `${c.id}|${issue.kind}`)} onChange={(e) => acknowledge(issue.kind === 'corporate-action' ? `${c.announcement.ticker}|${issue.kind}` : `${c.id}|${issue.kind}`, e.target.checked)} /> I have checked this</label>
                        ) : null}
                      </small>
                    ))}
                    {!actionable && c.issues.map((issue) => <small key={issue.kind}>{issue.message}</small>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ir-totals">
        <span>
          <b>{picked.length}</b> selected · <b>{money(total)}</b> gross
          <small>Calculated entitlement, not a bank amount. Payment dates stay unknown; no tax is recorded.</small>
        </span>
        <span className="row">
          <button type="button" className="secondary compact" disabled={!selectable.length || busy}
            onClick={() => setSelected(new Set(selectable.map((c) => c.id)))}>Select all resolved ({selectable.length})</button>
          <button type="button" className="secondary compact" disabled={!selected.size} onClick={() => setSelected(new Set())}>Deselect all</button>
          <button type="button" disabled={!picked.length || busy} onClick={() => void approve().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
            Approve selected as received
          </button>
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Approving confirms you received these dividends; no bank evidence is required. Existing estimated tax figures elsewhere stay labelled as estimates.
      </p>
    </div>
  );
}
