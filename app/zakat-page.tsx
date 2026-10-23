'use client';
// Zakat (Beta): the person's zakat year, what they would owe if their zakat day were today, what they have paid and what
// is left. Everything is worked out here from the decrypted ledger plus public rates; nothing leaves the device.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Plus, Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { PortfolioAccount } from '@/lib/portfolio-account';
import { today } from '@/lib/portfolio';
import { fxRowsWithHistory, type FxRatesResponse } from '@/lib/fx-rates';
import type { PricePoint } from '@/lib/price-history';
import {
  PAYMENT_KINDS,
  activePayments,
  applySchool,
  daysBetween,
  firstOfHijriMonth,
  hijriDayMonth,
  hijriLabel,
  lockDueYears,
  lockPending,
  manualLabel,
  newBook,
  reopenLastYear,
  toHijri,
  upcomingReminders,
  yearDue,
  zakatBreakdown,
  zakatProgress,
  type ZakatBook,
  type ZakatInputs,
  type ZakatManualItem,
  type ZakatManualKind,
  type ZakatPayment,
  type ZakatPaymentKind,
  type ZakatSchool,
  type ZakatSettings,
  type ZakatYear,
} from '@/lib/zakat';
import { track } from './analytics';
import { webPublicData } from './vault-transport';
import { Segmented } from './ui-kit';

const num0 = (n: number) => Math.round(n).toLocaleString('en-PK');
const rs = (n: number) => `Rs ${num0(n)}`;
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

const SCHOOL_LABELS: Record<ZakatSchool, string> = {
  hanafi: 'Hanafi',
  shafii: "Shafi'i",
  maliki: 'Maliki',
  hanbali: 'Hanbali',
  custom: 'Custom',
};
const PAYMENT_LABELS: Record<ZakatPaymentKind, string> = {
  direct: 'Given directly',
  organisation: 'To an organisation',
  bank: 'Bank deduction (1 Ramadan)',
  deducted: 'Deducted from a dividend or fund',
  other: 'Other',
};

type Parts = PortfolioAccount['portfolios'];
type Save = (next: ZakatBook | null, message: string) => Promise<unknown>;
type SaveBook = (next: ZakatBook, message: string) => Promise<unknown>;

export default function ZakatPage({
  parts,
  book,
  rates,
  fxHistory,
  ready,
  busy,
  onSave,
}: {
  parts: Parts;
  book: ZakatBook | null;
  rates: ZakatInputs;
  /** The stored foreign currency history, for rates of past days. */
  fxHistory: FxRatesResponse['history'];
  /** The public rates and prices this page needs have finished loading. */
  ready: boolean;
  busy: boolean;
  /** An empty message saves quietly (used for the weekly trail point). */
  onSave: Save;
}) {
  const asOf = today();
  const [view, setView] = useState<'overview' | 'method'>('overview');
  const lockError = useAutoLock(book, parts, rates, fxHistory, ready, asOf, busy, onSave);
  useEffect(() => {
    if (!book) setView('overview');
  }, [book]);
  if (!book)
    return (
      <div className="zk-page">
        <Setup parts={parts} asOf={asOf} busy={busy} onSave={onSave} />
      </div>
    );
  return (
    <div className="zk-page">
      {view === 'method' ? (
        <Method book={book} parts={parts} asOf={asOf} busy={busy} onSave={onSave} onDone={() => setView('overview')} />
      ) : (
        <Overview book={book} parts={parts} rates={rates} asOf={asOf} busy={busy} lockError={lockError} onSave={onSave as SaveBook} onMethod={() => setView('method')} />
      )}
    </div>
  );
}

/**
 * Fixes a zakat year from its zakat day's values once that day has passed: the closes of that day are fetched and the
 * year is saved. If they cannot be loaded nothing is fixed (the amount is never taken from a later day by accident) and
 * the next visit tries again.
 */
function useAutoLock(
  book: ZakatBook | null,
  parts: Parts,
  rates: ZakatInputs,
  fxHistory: FxRatesResponse['history'],
  ready: boolean,
  asOf: string,
  busy: boolean,
  onSave: Save,
): string {
  const [error, setError] = useState('');
  const tried = useRef('');
  useEffect(() => {
    // Wait until the public rates and prices are loaded: fixing a year before that would leave assets out of it.
    if (!book || busy || !ready || !lockPending(book, asOf)) return;
    const key = `${book.years.length}:${asOf}`;
    if (tried.current === key) return;
    tried.current = key;
    const tickers = [...new Set(parts.flatMap((p) => p.portfolio.companies.map((c) => c.ticker)))];
    const fundIds = [...new Set(parts.flatMap((p) => (p.portfolio.assets ?? []).flatMap((a) => (a.kind === 'fund' ? [a.mufapId] : []))))];
    void (async () => {
      try {
        let closes: Record<string, PricePoint[]> = {};
        if (tickers.length) {
          const r = await fetch(`/api/price-history?tickers=${encodeURIComponent(tickers.join(','))}`);
          const d = (await r.json()) as { histories?: Record<string, { eod: number[][] }> };
          if (!r.ok || !d.histories) throw new Error('prices');
          closes = Object.fromEntries(
            Object.entries(d.histories).map(([t, h]) => [t, h.eod.filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > 0).map((x): PricePoint => [x[0], x[1]]).sort((a, b) => a[0] - b[0])]),
          );
        }
        // Funds and currencies are valued at their price of the zakat day, so their history is needed, not just today's price.
        const histories = await Promise.all(fundIds.map((id) => webPublicData.fundHistory?.(id)));
        const fundNavs = [...(rates.fundNavs ?? []), ...histories.flatMap((h) => h?.navs ?? [])];
        const fxRates = fxRowsWithHistory({ rates: rates.fxRates ?? [], history: fxHistory });
        const next = lockDueYears(book, parts, { ...rates, closes, fundNavs, fxRates }, asOf);
        const fixed = next.years.slice(book.years.length);
        await onSave(next, fixed.length === 1 ? `Zakat for your year ending ${longDate(fixed[0].due)} is fixed at ${rs(fixed[0].amountDue)}.` : 'Your zakat years are fixed from their zakat days.');
        for (const y of fixed) track('zakat_year_closed', { state: y.amountDue === 0 ? 'below_nisab' : 'partial' });
        setError('');
      } catch {
        setError("Your zakat day has passed but its prices could not be loaded, so the amount isn't fixed yet. It will try again next time you open this page.");
      }
    })();
  }, [book, parts, rates, fxHistory, ready, asOf, busy, onSave]);
  return error;
}

// ───────────────────────── Overview ─────────────────────────

function Overview({
  book,
  parts,
  rates,
  asOf,
  busy,
  lockError,
  onSave,
  onMethod,
}: {
  book: ZakatBook;
  parts: Parts;
  rates: ZakatInputs;
  asOf: string;
  busy: boolean;
  lockError: string;
  onSave: SaveBook;
  onMethod: () => void;
}) {
  // Only the progress is used: the amount of a year is whatever was fixed on its zakat day, never a running estimate.
  const progress = useMemo(() => zakatProgress(book, zakatBreakdown(parts, book, rates, asOf), asOf), [parts, book, rates, asOf]);
  const [payment, setPayment] = useState<ZakatPayment | 'new' | null>(null);
  const [error, setError] = useState('');
  const { year } = progress;

  const reminder = upcomingReminders(book, asOf).find((r) => daysBetween(asOf, r.date) <= 14);
  const payments = activePayments(book).slice().reverse();
  const dueH = toHijri(year.due);
  const latest = progress.past[progress.past.length - 1];
  const latestClosed = latest ? book.years.find((c) => c.id === latest.id) : undefined;
  const older = progress.past.slice(0, -1).reverse();
  const pastDue = progress.past.reduce((n, y) => n + y.amountDue, 0);
  const pastPaid = progress.past.reduce((n, y) => n + Math.min(y.paid, y.amountDue), 0);
  const pastPercent = pastDue > 0 ? Math.min(100, Math.round((pastPaid / pastDue) * 100)) : 100;
  const advance = progress.paid;
  const ramadan = payments.find((p) => p.kind === 'bank');

  return (
    <>
      <header className="zk-head">
        <div>
          <p className="zk-sub">
            Your zakat day is {hijriDayMonth(dueH)} every year. {SCHOOL_LABELS[book.settings.school]} · {book.settings.nisab} nisab · {book.settings.year} year
          </p>
        </div>
        <div className="zk-actions">
          <button type="button" data-slot="sp-ghost" onClick={onMethod}>
            <Settings2 size={15} aria-hidden="true" /> How it&apos;s counted
          </button>
          <button type="button" className="compact" disabled={busy} onClick={() => setPayment('new')}>
            <Plus size={15} aria-hidden="true" /> Log a payment
          </button>
        </div>
      </header>

      {progress.closeDue && (
        <div className="zk-banner" data-tone="warn">
          <div>
            {asOf === year.due ? (
              <>
                <b>Today is your zakat day.</b> The amount is fixed tomorrow from today&apos;s closing prices.
              </>
            ) : (
              <>
                <b>Your zakat day, {longDate(year.due)}, has passed.</b> {lockError || 'The amount is being fixed from that day’s values.'}
              </>
            )}
          </div>
        </div>
      )}
      {!progress.closeDue && reminder && (
        <div className="zk-banner">
          <div>
            <b>{reminder.title}</b> · {longDate(reminder.date)}. {reminder.body}
          </div>
          {reminder.id === 'ramadan' && (
            <button type="button" className="compact" onClick={() => setPayment('new')}>
              Log it
            </button>
          )}
        </div>
      )}

      {latest ? (
        <section className="slab zk-slab" aria-label="Zakat to pay">
          <div className="zk-slab-main">
            <p className="lbl">
              Zakat to pay · year {latest.name}, fixed on {longDate(latest.due)}
            </p>
            <div className="zk-big num">{rs(progress.arrears)}</div>
            <div className="zk-chips">
              <span className="zk-chip" data-tone={progress.arrears > 0 ? 'warn' : 'ok'}>
                {progress.arrears > 0 ? 'Still to pay' : 'All paid'}
              </span>
              <span className="zk-chip">
                Valued on {hijriDayMonth(toHijri(latest.due))} {toHijri(latest.due).year} · {longDate(latest.due)}
              </span>
              {advance > 0 && <span className="zk-chip" data-tone="ok">Extra {rs(advance)} counts toward next year</span>}
            </div>
          </div>
          <div className="zk-slab-side">
            <div className="zk-ring" style={{ '--p': `${pastPercent}%` } as React.CSSProperties}>
              <div>
                <b className="num">{pastPercent}%</b>
                <small>paid</small>
              </div>
            </div>
            <dl className="zk-legend">
              <div>
                <dt>
                  <i data-c="paid" />
                  Paid
                </dt>
                <dd className="num">{rs(pastPaid)}</dd>
              </div>
              <div>
                <dt>
                  <i data-c="left" />
                  Left to pay
                </dt>
                <dd className="num">{rs(progress.arrears)}</dd>
              </div>
              <small>Fixed amount: {rs(pastDue)}</small>
            </dl>
          </div>
        </section>
      ) : (
        <section className="slab zk-slab" aria-label="First zakat day">
          <div className="zk-slab-main">
            <p className="lbl">Your first zakat day</p>
            <div className="zk-big num">{longDate(year.due)}</div>
            <div className="zk-chips">
              <span className="zk-chip">
                {hijriDayMonth(dueH)} {dueH.year}
              </span>
              <span className="zk-chip" data-tone={progress.daysLeft <= 14 ? 'warn' : undefined}>
                {progress.closeDue ? 'Zakat day reached' : `${progress.daysLeft} ${progress.daysLeft === 1 ? 'day' : 'days'} left`}
              </span>
            </div>
            <p className="zk-sub">
              Nothing is due yet. On that day your portfolio is valued and the amount is fixed here, with everything you held at that moment.
              {advance > 0 ? ` You have already paid ${rs(advance)}, which will count toward it.` : ''}
            </p>
          </div>
        </section>
      )}

      {latest && latestClosed && (
        <section className="panel zk-card">
          <div className="zk-card-head">
            <div>
              <h2>How your {latest.name} zakat was worked out</h2>
              <p className="zk-sub">
                Your portfolio was valued on {longDate(latest.due)} ({hijriDayMonth(toHijri(latest.due))} {toHijri(latest.due).year}). This amount is fixed and does not move.
              </p>
            </div>
            <div className="zk-actions">
              <span className="zk-chip">Nisab {rs(latestClosed.snapshot.nisab.value)}</span>
              <button
                type="button"
                data-slot="sp-ghost"
                disabled={busy}
                title="Works this year out again from the values of its zakat day"
                onClick={() => void onSave(reopenLastYear(book), 'Working this year out again from its zakat day.').catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not recalculate.'))}
              >
                Recalculate
              </button>
            </div>
          </div>
          {error && <p className="notice error">{error}</p>}
          <SnapshotTable year={latestClosed} />
        </section>
      )}

      <section className="panel zk-card">
        <div className="zk-card-head">
          <div>
            <h2>Payments</h2>
            <p className="zk-sub">Payments clear the oldest fixed year first. Anything extra is kept and counts toward the next year.</p>
          </div>
          <button type="button" data-slot="sp-ghost" disabled={busy} onClick={() => setPayment('new')}>
            <Plus size={15} aria-hidden="true" /> Log
          </button>
        </div>
        {payments.length === 0 ? (
          <p className="zk-sub">No payments yet. If your bank deducted zakat on 1 Ramadan, log it here so you do not pay twice.</p>
        ) : (
          <ul className="zk-pay-list">
            {payments.map((p) => (
              <li key={p.id}>
                <button type="button" data-slot="zk-row" onClick={() => setPayment(p)} aria-label={`Edit payment of ${rs(p.amount)} on ${longDate(p.date)}`}>
                  <span className="zk-pay-ic" data-kind={p.kind} aria-hidden="true" />
                  <span className="zk-pay-text">
                    <b>{p.note || PAYMENT_LABELS[p.kind]}</b>
                    <small>
                      {p.note ? `${PAYMENT_LABELS[p.kind]} · ` : ''}
                      {longDate(p.date)} · {hijriDayMonth(toHijri(p.date))}
                    </small>
                  </span>
                  <b className="num">{rs(p.amount)}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
        {latest && (
          <dl className="zk-totals">
            <div>
              <dt>Zakat fixed</dt>
              <dd className="num">{rs(pastDue)}</dd>
            </div>
            <div>
              <dt>Paid toward it</dt>
              <dd className="num" data-tone="ok">
                {rs(pastPaid)}
              </dd>
            </div>
            <div>
              <dt>Left to pay</dt>
              <dd className="num">{rs(progress.arrears)}</dd>
            </div>
            {advance > 0 && (
              <div>
                <dt>Extra, for next year</dt>
                <dd className="num" data-tone="ok">
                  {rs(advance)}
                </dd>
              </div>
            )}
          </dl>
        )}
        {!ramadan && (
          <p className="zk-note">Banks deduct 2.5% on 1 Ramadan from savings accounts above the nisab. That counts as zakat paid: log it when it happens.</p>
        )}
      </section>

      {older.length > 0 && (
        <section className="panel zk-card">
          <div className="zk-card-head">
            <div>
              <h2>Earlier years</h2>
            </div>
          </div>
          <div className="zk-past">
            <ul>
              {older.map((y) => {
                const closed = book.years.find((c) => c.id === y.id);
                return (
                  <li key={y.id}>
                    <span>
                      {y.name} · valued on {longDate(y.due)}
                    </span>
                    <span className="num">{y.remaining === 0 ? `Fully paid (${rs(y.amountDue)})` : `${rs(y.remaining)} still to pay of ${rs(y.amountDue)}`}</span>
                    {closed && (
                      <details className="zk-fixed">
                        <summary>Values on {longDate(y.due)}</summary>
                        <SnapshotTable year={closed} />
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <p className="zk-fine">
        A calculator based on common scholarly defaults in Pakistan, not a fatwa. If you are unsure how your wealth should count, ask your scholar.
      </p>

      {payment && (
        <PaymentDialog
          key={payment === 'new' ? 'new' : payment.id}
          book={book}
          remaining={progress.arrears}
          existing={payment === 'new' ? null : payment}
          asOf={asOf}
          busy={busy}
          onClose={() => setPayment(null)}
          onSave={async (next, message, kind) => {
            await onSave(next, message);
            if (kind) track('zakat_payment_logged', { kind });
            setPayment(null);
          }}
        />
      )}
    </>
  );
}

/** The frozen figures of a fixed year: what was held on its zakat day and how the amount came out. */
function SnapshotTable({ year }: { year: ZakatYear }) {
  const s = year.snapshot;
  return (
    <>
      <div className="scroll">
        <table className="zk-table">
          <thead>
            <tr>
              <th>Wealth</th>
              <th>Value</th>
              <th>Counts</th>
              <th>Zakatable</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.key} data-kind={r.kind}>
                <td>
                  {r.label}
                  <small>{r.detail}</small>
                </td>
                <td className="num">{r.kind === 'debt' ? '' : num0(r.value)}</td>
                <td className="num">{r.kind === 'debt' ? '' : `${Math.round(r.share * 100)}%`}</td>
                <td className="num">
                  {r.kind === 'debt' ? '−' : ''}
                  {num0(r.counted)}
                </td>
              </tr>
            ))}
            <tr className="zk-sum">
              <td>Net zakatable wealth</td>
              <td />
              <td />
              <td className="num">{num0(s.net)}</td>
            </tr>
            <tr className="zk-total">
              <td>Zakat at {(s.rate * 100).toFixed(s.rate === 0.025 ? 1 : 3)}%</td>
              <td />
              <td />
              <td className="num">{rs(year.amountDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {s.rows.length === 0 && <p className="zk-sub">Nothing counted on that day.</p>}
      {s.missing && s.missing.length > 0 && (
        <p className="zk-note" data-tone="warn">
          Left out because they could not be valued on that day: {s.missing.join('; ')}.
        </p>
      )}
      {s.net < s.nisab.value && <p className="zk-note">Below the nisab of {rs(s.nisab.value)} on that day, so nothing was due.</p>}
      {s.valuedOnDay === false && <p className="zk-note" data-tone="warn">The closing prices of that day were not available, so the latest prices of {longDate(year.closedAt)} were used.</p>}
    </>
  );
}

// ───────────────────────── Dialogs ─────────────────────────

function PaymentDialog({
  book,
  remaining,
  existing,
  asOf,
  busy,
  onClose,
  onSave,
}: {
  book: ZakatBook;
  remaining: number;
  existing: ZakatPayment | null;
  asOf: string;
  busy: boolean;
  onClose: () => void;
  onSave: (next: ZakatBook, message: string, loggedKind?: ZakatPaymentKind) => Promise<unknown>;
}) {
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [date, setDate] = useState(existing?.date ?? asOf);
  const [kind, setKind] = useState<ZakatPaymentKind>(existing?.kind ?? 'direct');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= asOf;
  const hijri = /^\d{4}-\d{2}-\d{2}$/.test(date) ? hijriLabel(toHijri(date)) : '';
  const left = Math.max(0, remaining - (valid ? value - (existing?.amount ?? 0) : 0));

  const commit = (payments: ZakatPayment[], message: string, logged?: ZakatPaymentKind) =>
    onSave({ ...book, payments }, message, logged).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog zk-dialog">
        <DialogTitle>{existing ? 'Edit zakat payment' : 'Log a zakat payment'}</DialogTitle>
        <DialogDescription>Payments made during the year count toward that year&apos;s zakat.</DialogDescription>
        <label>
          Amount (Rs)
          <input type="number" inputMode="decimal" min="0" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Date
          <input type="date" max={asOf} value={date} onChange={(e) => setDate(e.target.value)} />
          <small>{hijri}</small>
        </label>
        <div className="zk-field">
          <span>How was it paid?</span>
          <div className="zk-kinds" role="group" aria-label="Payment kind">
            {PAYMENT_KINDS.map((k) => (
              <button key={k} type="button" data-slot="zk-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {PAYMENT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <label>
          Note (optional, stays encrypted on your devices)
          <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {valid && (
          <p className="zk-note">
            Left to pay after this: <b className="num">{rs(left)}</b>
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="row tx-actions">
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => {
              setError('');
              const entry: ZakatPayment = { id: existing?.id ?? crypto.randomUUID(), date, amount: value, kind, note: note.trim() };
              void commit(
                existing ? book.payments.map((p) => (p.id === existing.id ? entry : p)) : [...book.payments, entry],
                existing ? 'Payment updated.' : 'Zakat payment saved.',
                existing ? undefined : kind,
              );
            }}
          >
            Save payment
          </button>
          {existing && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void commit(book.payments.map((p) => (p.id === existing.id ? { ...p, voided: true } : p)), 'Payment removed.')}
            >
              Remove
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Counting rules and amounts ─────────────────────────

function CountingRules({ settings, onChange }: { settings: ZakatSettings; onChange: (s: ZakatSettings) => void }) {
  const set = (patch: Partial<ZakatSettings>) => onChange({ ...settings, ...patch, school: 'custom' });
  return (
    <div className="zk-rules">
      <div className="zk-rule">
        <div>
          <b>School</b>
          <small>Sets the usual rulings below in one go. You can still change any of them.</small>
        </div>
        <Segmented
          label="School"
          value={settings.school}
          options={(['hanafi', 'shafii', 'maliki', 'hanbali', 'custom'] as const).map((s) => ({ value: s, label: SCHOOL_LABELS[s] }))}
          onChange={(school) => onChange(applySchool(settings, school))}
        />
      </div>
      <div className="zk-rule">
        <div>
          <b>Nisab</b>
          <small>Silver (52.5 tola) is lower, so more people pay; the government uses it. Gold is 7.5 tola.</small>
        </div>
        <Segmented
          label="Nisab"
          value={settings.nisab}
          options={[
            { value: 'silver', label: 'Silver' },
            { value: 'gold', label: 'Gold' },
          ]}
          onChange={(nisab) => set({ nisab })}
        />
      </div>
      <div className="zk-rule">
        <div>
          <b>Year</b>
          <small>Lunar at 2.5%, or Gregorian at 2.577% to make up the 11 extra days.</small>
        </div>
        <Segmented
          label="Year"
          value={settings.year}
          options={[
            { value: 'lunar', label: 'Lunar' },
            { value: 'solar', label: 'Gregorian' },
          ]}
          onChange={(year) => set({ year })}
        />
      </div>
      <div className="zk-rule">
        <div>
          <b>Shares and equity funds</b>
          <small>Bought for growth: full market value. Held long term for dividends: the company&apos;s zakatable share, about 25% when unknown.</small>
        </div>
        <Segmented
          label="Shares"
          value={settings.shares}
          options={[
            { value: 'market', label: 'Full value' },
            { value: 'proxy25', label: '25% share' },
          ]}
          onChange={(shares) => set({ shares, equityFunds: shares })}
        />
      </div>
      <Toggle
        title="Jewellery you wear"
        text="Hanafi: zakatable. Other schools: exempt for normal use."
        on={settings.jewellery === 'include'}
        onChange={(on) => set({ jewellery: on ? 'include' : 'exclude' })}
      />
      <Toggle
        title="Deduct debts"
        text="Bills due now plus at most 12 months of instalments, never the whole loan."
        on={settings.debts === 'deduct'}
        onChange={(on) => set({ debts: on ? 'deduct' : 'none' })}
      />
      <Toggle
        title="Savings plans"
        text="Counted at the value you could take out."
        on={settings.plans === 'include'}
        onChange={(on) => set({ plans: on ? 'include' : 'exclude' })}
      />
    </div>
  );
}

function Toggle({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" data-slot="sp-switch" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="zk-rule zk-rule-switch">
      <span className="sp-switch-text">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <span className="sp-switch-track">
        <i />
      </span>
    </button>
  );
}

const AMOUNT_ROWS: { kind: ZakatManualKind; hint: string }[] = [
  { kind: 'cash', hint: 'Cash at home or in a wallet' },
  { kind: 'bank', hint: 'Current, savings and profit accounts' },
  { kind: 'jewellery', hint: 'Gold and silver ornaments you own, at today’s value' },
  { kind: 'receivable', hint: 'Loans you gave that you expect back' },
  { kind: 'property', hint: 'Plots or flats bought to resell' },
  { kind: 'debt', hint: 'Bills due now plus the next 12 months of instalments' },
];

// ───────────────────────── Setup ─────────────────────────

function Setup({ parts, asOf, busy, onSave }: { parts: Parts; asOf: string; busy: boolean; onSave: Save }) {
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<ZakatSettings>(() => newBook(asOf).settings);
  const [amounts, setAmounts] = useState<Partial<Record<ZakatManualKind, string>>>({});
  const [error, setError] = useState('');
  const start = settings.startDate;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && start <= asOf;
  const startH = valid ? toHijri(start) : null;
  const due = valid ? yearDue(settings, 0) : '';
  const names = ['Your zakat date', 'Whose wealth', 'How to count', "What the app can't see"];

  // The next 1 Ramadan, as a quick choice.
  const quickRamadan = () => {
    const h = toHijri(asOf);
    const year = h.month > 9 || (h.month === 9 && h.day >= 1) ? h.year : h.year - 1;
    setSettings({ ...settings, startDate: firstOfHijriMonth(year, 9) });
  };

  async function finish() {
    setError('');
    const items: ZakatManualItem[] = [];
    for (const row of AMOUNT_ROWS) {
      const n = Number(amounts[row.kind]);
      if (Number.isFinite(n) && n > 0) items.push({ id: crypto.randomUUID(), kind: row.kind, amount: n, asOf, note: '' });
    }
    try {
      await onSave({ ...newBook(asOf), settings, items }, 'Zakat set up.');
      track('zakat_setup_done', { school: settings.school, nisab: settings.nisab, year: settings.year });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <section className="panel zk-setup">
      <ol className="zk-steps" aria-label="Setup steps">
        {names.map((n, i) => (
          <li key={n} data-on={step === i + 1 || undefined} data-done={step > i + 1 || undefined}>
            <i>{i + 1}</i>
            {n}
          </li>
        ))}
      </ol>
      <div className="zk-setup-body">
        <p className="lbl">Step {step} of 4 · Beta</p>
        {step === 1 && (
          <>
            <h2>When does your zakat year start?</h2>
            <p className="zk-sub">
              The day you first had savings above the nisab. Zakat is then worked out on the same Hijri date every year. Not sure? Pick your best guess and keep it.
            </p>
            <div className="zk-quick">
              <button type="button" data-slot="zk-chip" aria-pressed="false" onClick={() => setSettings({ ...settings, startDate: asOf })}>
                Today
              </button>
              <button type="button" data-slot="zk-chip" aria-pressed="false" onClick={quickRamadan}>
                Last 1 Ramadan
              </button>
            </div>
            <label className="zk-date">
              Zakat date
              <input type="date" max={asOf} value={start} onChange={(e) => setSettings({ ...settings, startDate: e.target.value })} />
            </label>
            {valid && startH && (
              <div className="zk-hijri">
                <b>{hijriDayMonth(startH)}</b>
                <span>
                  {weekday(start)} {longDate(start)} ({hijriLabel(startH)})
                </span>
                <span>
                  This year&apos;s zakat is due <b>{longDate(due)}</b>
                </span>
                <small>Moon sighting in Pakistan can differ by a day. You can adjust the due date later.</small>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <h2>Whose wealth is this?</h2>
            <p className="zk-sub">Zakat is per person. Leave out a portfolio you keep for someone else, such as a child or a spouse.</p>
            <div className="zk-rules">
              {parts.map((p) => {
                const on = settings.portfolioIds.length === 0 || settings.portfolioIds.includes(p.id);
                return (
                  <Toggle
                    key={p.id}
                    title={p.name}
                    text={on ? 'Counted' : 'Not counted'}
                    on={on}
                    onChange={(next) => {
                      const current = settings.portfolioIds.length ? settings.portfolioIds : parts.map((x) => x.id);
                      const ids = next ? [...new Set([...current, p.id])] : current.filter((id) => id !== p.id);
                      setSettings({ ...settings, portfolioIds: ids.length === parts.length ? [] : ids });
                    }}
                  />
                );
              })}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>How should it be counted?</h2>
            <p className="zk-sub">Defaults follow the Hanafi practice most Pakistanis use. This is not a fatwa: ask your scholar if unsure.</p>
            <CountingRules settings={settings} onChange={setSettings} />
          </>
        )}
        {step === 4 && (
          <>
            <h2>What the app can&apos;t see</h2>
            <p className="zk-sub">
              Stocks, funds, gold, savings plans and foreign currency come from your portfolios. Add anything else you own. Leave a line empty if it does not apply; you can change these any time.
            </p>
            <div className="zk-amounts">
              {AMOUNT_ROWS.map((r) => (
                <label key={r.kind}>
                  {manualLabel(r.kind)}
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    placeholder="0"
                    value={amounts[r.kind] ?? ''}
                    onChange={(e) => setAmounts({ ...amounts, [r.kind]: e.target.value })}
                  />
                  <small>{r.hint}</small>
                </label>
              ))}
            </div>
          </>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="zk-setup-actions">
          {step > 1 && (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 4 ? (
            <button type="button" disabled={step === 1 && !valid} onClick={() => setStep(step + 1)}>
              Next: {names[step].toLowerCase()}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void finish()}>
              Start tracking
            </button>
          )}
        </div>
        <p className="zk-fine">Everything here stays inside your encrypted vault. Sipwise never sees it.</p>
      </div>
    </section>
  );
}


// ───────────────────────── How it's counted ─────────────────────────

function Method({
  book,
  parts,
  asOf,
  busy,
  onSave,
  onDone,
}: {
  book: ZakatBook;
  parts: Parts;
  asOf: string;
  busy: boolean;
  onSave: Save;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<ZakatBook>(book);
  const [error, setError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(book);
  const s = draft.settings;
  const setSettings = (settings: ZakatSettings) => setDraft({ ...draft, settings });
  const setItem = (kind: ZakatManualKind, amount: number | null) => {
    const rest = draft.items.filter((i) => i.kind !== kind);
    setDraft({
      ...draft,
      items: amount && amount > 0 ? [...rest, { id: draft.items.find((i) => i.kind === kind)?.id ?? crypto.randomUUID(), kind, amount, asOf, note: draft.items.find((i) => i.kind === kind)?.note ?? '' }] : rest,
    });
  };
  const toggleOwn = (id: string, next: boolean) => {
    const current = s.portfolioIds.length ? s.portfolioIds : parts.map((x) => x.id);
    const ids = next ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    setSettings({ ...s, portfolioIds: ids.length === parts.length ? [] : ids });
  };
  const nudge = s.dueShiftDays ?? 0;
  const startH = toHijri(s.startDate);

  async function reset() {
    setError('');
    try {
      await onSave(null, 'Zakat removed. Set it up again when you are ready.');
      onDone();
    } catch (e) {
      setResetting(false);
      setError(e instanceof Error ? e.message : 'Could not reset.');
    }
  }

  async function save() {
    setError('');
    try {
      await onSave(draft, 'Zakat settings saved.');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <>
      <header className="zk-head">
        <div>
          <p className="zk-sub">Common scholarly defaults for Pakistan. This is not a fatwa: ask your scholar if unsure.</p>
        </div>
        <div className="zk-actions">
          <button type="button" data-slot="sp-ghost" onClick={onDone}>
            {changed ? 'Discard' : 'Back'}
          </button>
          <button type="button" className="compact" disabled={busy || !changed} onClick={() => void save()}>
            Save changes
          </button>
        </div>
      </header>
      <div className="zk-grid">
        <section className="panel zk-card">
          <h2>Method</h2>
          <CountingRules settings={s} onChange={setSettings} />
        </section>
        <div className="zk-stack">
          <section className="panel zk-card">
            <h2>What the app can&apos;t see</h2>
            <p className="zk-sub">Update these before your zakat day.</p>
            <div className="zk-amounts">
              {AMOUNT_ROWS.map((r) => {
                const item = draft.items.find((i) => i.kind === r.kind);
                return (
                  <label key={r.kind}>
                    {manualLabel(r.kind)}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="0"
                      value={item?.amount ?? ''}
                      onChange={(e) => setItem(r.kind, e.target.value === '' ? null : Number(e.target.value))}
                    />
                    <small>{item ? `Last checked ${longDate(item.asOf)}` : r.hint}</small>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="panel zk-card">
            <h2>Whose wealth</h2>
            <div className="zk-rules">
              {parts.map((p) => (
                <Toggle
                  key={p.id}
                  title={p.name}
                  text={s.portfolioIds.length === 0 || s.portfolioIds.includes(p.id) ? 'Counted' : 'Not counted'}
                  on={s.portfolioIds.length === 0 || s.portfolioIds.includes(p.id)}
                  onChange={(on) => toggleOwn(p.id, on)}
                />
              ))}
            </div>
          </section>
          <section className="panel zk-card">
            <h2>Your zakat date</h2>
            <p className="zk-sub">
              {hijriLabel(startH)} · {longDate(s.startDate)}. Each year is due on the same Hijri day.
            </p>
            <div className="zk-rule">
              <div>
                <b>Moon sighting</b>
                <small>Move the due date by a day or two if Pakistan&apos;s sighting differs.</small>
              </div>
              <Segmented
                label="Due date shift"
                value={String(nudge)}
                options={['-1', '0', '1'].map((v) => ({ value: v, label: v === '0' ? 'None' : v === '1' ? '+1 day' : '−1 day' }))}
                onChange={(v) => setSettings({ ...s, dueShiftDays: Number(v) as -1 | 0 | 1 })}
              />
            </div>
            {book.years.length === 0 ? (
              dateOpen ? (
                <label className="zk-date">
                  Zakat date
                  <input type="date" max={asOf} value={s.startDate} onChange={(e) => e.target.value && setSettings({ ...s, startDate: e.target.value })} />
                  <small>Only change this if you picked the wrong day. Closed years are never moved.</small>
                </label>
              ) : (
                <button type="button" data-slot="sp-ghost" onClick={() => setDateOpen(true)}>
                  <CalendarDays size={15} aria-hidden="true" /> Change zakat date
                </button>
              )
            ) : (
              <p className="zk-note">A year has been closed, so the zakat date can no longer be moved.</p>
            )}
          </section>
          <section className="panel zk-card">
            <h2>Reminders</h2>
            <div className="zk-rules">
              <Toggle title="A week before my zakat day" text="On this device only." on={s.remind.due} onChange={(on) => setSettings({ ...s, remind: { ...s.remind, due: on } })} />
              <Toggle
                title="CZ-50 deadline"
                text="30 days before 1 Ramadan: the last day to tell your bank you pay zakat yourself."
                on={s.remind.cz50}
                onChange={(on) => setSettings({ ...s, remind: { ...s.remind, cz50: on } })}
              />
              <Toggle
                title="1 Ramadan: log the bank deduction"
                text="So a deduction counts as paid."
                on={s.remind.ramadan}
                onChange={(on) => setSettings({ ...s, remind: { ...s.remind, ramadan: on } })}
              />
            </div>
          </section>
          <section className="panel zk-card">
            <h2>Start over</h2>
            <p className="zk-sub">
              Set the zakat date, method and amounts up again from scratch. This removes your zakat date, payments, amounts and fixed years from your portfolio.
            </p>
            <button type="button" className="secondary" disabled={busy} onClick={() => setResetting(true)}>
              Start zakat over
            </button>
          </section>
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {resetting && (
        <Dialog open onOpenChange={(v) => !v && setResetting(false)}>
          <DialogContent className="form-dialog zk-dialog">
            <DialogTitle>Start zakat over?</DialogTitle>
            <DialogDescription>
              Your zakat date, payments, amounts and fixed years are removed from your encrypted portfolio. Your holdings are not touched. You will set zakat up again from the beginning.
            </DialogDescription>
            <div className="row tx-actions">
              <button type="button" disabled={busy} onClick={() => void reset()}>
                Remove and start over
              </button>
              <button type="button" className="secondary" onClick={() => setResetting(false)}>
                Keep it
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
