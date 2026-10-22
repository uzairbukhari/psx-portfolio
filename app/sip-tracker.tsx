'use client';
// My SIP: one page that answers three questions in order. What do I buy this month? Am I keeping the habit? What does
// this become if I keep going? Every figure is worked out here from the decrypted ledger and public rates; the plan is
// saved only inside the encrypted portfolio.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { today } from '@/lib/portfolio';
import { type SipBlueprint, type SipClass, type SipMonth } from '@/lib/sip-blueprint';
import { classWeights, sipMonthState, type QuickEntry, type SipRates } from '@/lib/sip-blueprint-data';
import { SipHabit, SipHero, SipPlan } from './sip-tracker-plan';
import { PlanEditor, SipWizard, editorFrom, type EditorValue } from './sip-tracker-setup';

type Parts = Parameters<typeof classWeights>[0];

export default function SipTracker({
  parts,
  blueprint,
  rates,
  busy,
  canLog,
  hasStocks,
  onSave,
  onLog,
  onOpenPicks,
  onOpenHoldings,
}: {
  parts: Parts;
  blueprint: SipBlueprint | null;
  rates: SipRates;
  busy: boolean;
  /** At least one portfolio can take a new entry (not locked). */
  canLog: boolean;
  hasStocks: boolean;
  onSave: (next: SipBlueprint, message: string) => Promise<unknown>;
  onLog: (entry: QuickEntry, next: SipBlueprint) => Promise<unknown>;
  onOpenPicks: () => void;
  onOpenHoldings: () => void;
}) {
  const asOf = today();
  const month = asOf.slice(0, 7);
  const [editing, setEditing] = useState(false);

  if (!blueprint)
    return (
      <div className="sp-page">
        <SipWizard
          parts={parts}
          rates={rates}
          asOf={asOf}
          busy={busy}
          onStart={(v) => onSave(fromEditor(v, null, month), 'Your SIP is set. Here is this month’s plan.')}
        />
      </div>
    );

  return (
    <SipDashboard
      b={blueprint}
      parts={parts}
      rates={rates}
      asOf={asOf}
      month={month}
      busy={busy}
      canLog={canLog}
      hasStocks={hasStocks}
      onSave={onSave}
      onLog={onLog}
      onOpenPicks={onOpenPicks}
      onOpenHoldings={onOpenHoldings}
      editing={editing}
      setEditing={setEditing}
    />
  );
}

/** A blueprint from the editor. A month that has not started takes the new plan at once; a started one keeps its plan. */
function fromEditor(v: EditorValue, base: SipBlueprint | null, month: string): SipBlueprint {
  const months = { ...base?.months };
  const current = months[month];
  if (current && !Object.keys(current.done).length) delete months[month];
  return {
    ...base,
    budget: v.budget,
    day: v.day,
    preset: v.preset,
    targets: v.targets,
    strict: v.strict,
    notify: v.notify,
    since: base?.since ?? month,
    months,
  };
}

function SipDashboard({
  b,
  parts,
  rates,
  asOf,
  month,
  busy,
  canLog,
  hasStocks,
  onSave,
  onLog,
  onOpenPicks,
  onOpenHoldings,
  editing,
  setEditing,
}: {
  b: SipBlueprint;
  parts: Parts;
  rates: SipRates;
  asOf: string;
  month: string;
  busy: boolean;
  canLog: boolean;
  hasStocks: boolean;
  onSave: (next: SipBlueprint, message: string) => Promise<unknown>;
  onLog: (entry: QuickEntry, next: SipBlueprint) => Promise<unknown>;
  onOpenPicks: () => void;
  onOpenHoldings: () => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const st = useMemo(() => sipMonthState(b, parts, asOf, rates), [b, parts, asOf, rates]);
  const snapshot = b.months[month];

  /** This month's record with a change applied; the plan in force is frozen the first time anything is saved. */
  function withMonth(patch: Partial<SipMonth>, base: SipBlueprint = b): SipBlueprint {
    const current: SipMonth = snapshot ?? { budget: st.budget, plan: st.plan, done: {} };
    const next: SipMonth = { ...current, ...patch };
    if (patch.edited === undefined && 'edited' in patch) delete next.edited;
    return { ...base, months: { ...base.months, [month]: next } };
  }

  const actions = {
    markDone: (k: SipClass, amount: number, date: string) =>
      onSave(withMonth({ done: { ...snapshot?.done, [k]: { amount, date } } }), 'Marked done.'),
    undo: (k: SipClass) => {
      const { [k]: _gone, ...rest } = snapshot?.done ?? {};
      return onSave(withMonth({ done: rest }), 'Tick removed.');
    },
    log: (k: SipClass, entry: QuickEntry, amount: number) =>
      onLog(entry, withMonth({ done: { ...snapshot?.done, [k]: { amount, date: entry.date } } })),
    savePlan: (plan: Record<SipClass, number>) => onSave(withMonth({ plan, edited: true }), 'This month’s plan saved.'),
    resetPlan: () => onSave(withMonth({ plan: st.suggested, edited: undefined }), 'Back to the suggested plan.'),
    toggleRebalance: () => {
      const strict = !b.strict;
      const next: SipBlueprint = { ...b, strict };
      // A month nobody has hand-edited follows the switch straight away.
      if (snapshot && !snapshot.edited) {
        const suggested = sipMonthState({ ...next, months: {} }, parts, asOf, rates).suggested;
        next.months = { ...b.months, [month]: { ...snapshot, plan: suggested } };
      }
      return onSave(next, strict ? 'Fixed split on.' : 'Rebalancing with new money.');
    },
  };

  return (
    <div className="sp-page">
      <SipHero b={b} st={st} asOf={asOf} onEdit={() => setEditing(true)} />
      <SipPlan
        b={b}
        st={st}
        rates={rates}
        asOf={asOf}
        busy={busy}
        canLog={canLog}
        hasStocks={hasStocks}
        edited={!!snapshot?.edited}
        manualDone={snapshot?.done ?? {}}
        actions={actions}
        onOpenPicks={onOpenPicks}
        onOpenHoldings={onOpenHoldings}
        onEdit={() => setEditing(true)}
      />
      <SipHabit st={st} />
      {editing && (
        <EditDialog
          b={b}
          parts={parts}
          rates={rates}
          asOf={asOf}
          busy={busy}
          started={!!snapshot && Object.keys(snapshot.done).length > 0}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            await onSave(fromEditor(v, b, month), 'Plan updated.');
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  b,
  parts,
  rates,
  asOf,
  busy,
  started,
  onClose,
  onSave,
}: {
  b: SipBlueprint;
  parts: Parts;
  rates: SipRates;
  asOf: string;
  busy: boolean;
  started: boolean;
  onClose: () => void;
  onSave: (v: EditorValue) => Promise<unknown>;
}) {
  const [value, setValue] = useState<EditorValue>(() => editorFrom(b));
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog sp-dialog">
        <DialogTitle>Edit your SIP</DialogTitle>
        <DialogDescription>
          {started
            ? 'You have already started this month, so the new plan begins next month.'
            : 'Changes apply to this month straight away.'}
        </DialogDescription>
        <PlanEditor value={value} onChange={setValue} parts={parts} rates={rates} asOf={asOf} withSwitches />
        {error && <p className="notice error">{error}</p>}
        <div className="row tx-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError('');
              void onSave(value).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));
            }}
          >
            Save plan
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
