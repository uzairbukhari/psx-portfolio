'use client';
// New-user surfaces: the start screen an empty account lands on (import first, add by hand second, checklist beside
// it) and the slim "Getting started" strip that follows on Holdings. The rules live in lib/onboarding.ts.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileUp, RotateCcw, ShieldCheck } from 'lucide-react';
import { checklistProgress, PAGE_TIPS, type ChecklistId, type ChecklistItem, type TipId } from '@/lib/onboarding';
import { ASSET_CHOICES, type AssetPick } from './add-asset-menu';

const BROKERS = ['AHL (Arif Habib)', 'Finqalab', 'JS Global', 'Youngs Capital', 'Syed Faraz Equities', 'Other PSX statement'];
const IMPORT_ACCEPT = 'application/pdf,.pdf,application/json,.json,text/csv,.csv,.xlsx';

export type ChecklistActions = {
  /** Opens the place where a step is done (the Add dialog, Settings, SIP Blueprint, Insights). */
  onGo: (id: ChecklistId) => void;
  onTax: (status: 'filer' | 'non-filer') => void;
  onHide: () => void;
  busy?: boolean;
};

const GO_LABEL: Record<ChecklistId, string> = {
  vault: '',
  first_holding: 'Add a holding',
  tax: '',
  backup: 'Download a backup',
  sip_budget: 'Set a SIP budget',
  insights: 'Open Insights',
};

function Ring({ done, total }: { done: number; total: number }) {
  return (
    <span className="ob-ring" style={{ ['--p' as string]: `${Math.round((done / total) * 100)}%` }}>
      <b>
        {done}/{total}
        <span className="sr-only"> steps done</span>
      </b>
    </span>
  );
}

function TaxChoice({ onTax, busy }: { onTax: ChecklistActions['onTax']; busy?: boolean }) {
  return (
    <fieldset className="ob-tax">
      <legend className="sr-only">Your tax status</legend>
      <button type="button" data-slot="ob-btn" className="ob-btn ob-btn--sec" disabled={busy} onClick={() => onTax('filer')}>
        Filer · 15%
      </button>
      <button type="button" data-slot="ob-btn" className="ob-btn ob-btn--sec" disabled={busy} onClick={() => onTax('non-filer')}>
        Non-filer · 30%
      </button>
    </fieldset>
  );
}

/** The full list, for the start screen's side card. */
export function ChecklistCard({ items, actions, note }: { items: ChecklistItem[]; actions: ChecklistActions; note?: string }) {
  const { done, total, next } = checklistProgress(items);
  return (
    <section className="panel ob-card" aria-labelledby="ob-card-h">
      <div className="ob-card-head">
        <Ring done={done} total={total} />
        <div>
          <h2 id="ob-card-h">Getting started</h2>
          <small>Six steps to get the most out of Sipwise</small>
        </div>
      </div>
      <ul className="ob-list">
        {items.map((i) => (
          <li key={i.id} data-done={i.done || undefined} data-current={next?.id === i.id || undefined}>
            <span className="ob-box" aria-hidden="true">
              {i.done && <Check size={13} />}
            </span>
            <div>
              <b>
                {i.label}
                {i.done && <span className="sr-only"> (done)</span>}
              </b>
              <small>{i.hint}</small>
              {next?.id === i.id && i.id === 'tax' && <TaxChoice onTax={actions.onTax} busy={actions.busy} />}
              {next?.id === i.id && i.id !== 'tax' && GO_LABEL[i.id] && (
                <button type="button" data-slot="ob-btn" className="ob-btn" disabled={actions.busy} onClick={() => actions.onGo(i.id)}>
                  {GO_LABEL[i.id]}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="ob-card-foot">
        <small>{note}</small>
        <button type="button" data-slot="ob-link" className="ob-link" onClick={actions.onHide}>
          Hide
        </button>
      </div>
    </section>
  );
}

/** The slim card above the Holdings dashboard once there is something to look at. */
export function ChecklistStrip({
  items,
  actions,
  onAllDone,
}: {
  items: ChecklistItem[];
  actions: ChecklistActions;
  /** Called once every step is done, so the card can leave the next day. */
  onAllDone: () => void;
}) {
  const { done, total, next } = checklistProgress(items);
  useEffect(() => {
    if (!next) onAllDone();
  }, [next, onAllDone]);
  return (
    <section className="panel ob-strip" aria-labelledby="ob-strip-h">
      <Ring done={done} total={total} />
      <div className="ob-strip-title">
        <h2 id="ob-strip-h">{next ? 'Getting started' : 'You’re all set'}</h2>
        <small>{next ? `${done} of ${total} done · Next: ${next.label.toLowerCase()}` : 'Everything is ticked off. This card goes away tomorrow.'}</small>
      </div>
      <ul className="ob-chips" aria-label="Steps">
        {items.map((i) => (
          <li key={i.id} data-done={i.done || undefined} data-current={next?.id === i.id || undefined}>
            {i.done && <span className="sr-only">Done: </span>}
            {i.label}
          </li>
        ))}
      </ul>
      <div className="ob-strip-act">
        {next?.id === 'tax' ? (
          <TaxChoice onTax={actions.onTax} busy={actions.busy} />
        ) : next && GO_LABEL[next.id] ? (
          <button type="button" data-slot="ob-btn" className="ob-btn" disabled={actions.busy} onClick={() => actions.onGo(next.id)}>
            {GO_LABEL[next.id]}
          </button>
        ) : null}
        <button type="button" data-slot="ob-link" className="ob-link" onClick={actions.onHide}>
          Hide
        </button>
      </div>
    </section>
  );
}

/** What an account with nothing in it sees: import first, add by hand second, and the checklist beside it. */
export function StartScreen({
  disabled,
  only,
  onPick,
  onImportFile,
  onRestoreFile,
  onHelp,
  onMount,
  items,
  actions,
}: {
  disabled?: boolean;
  /** Limit the by-hand choices (the All view can only start with stocks). */
  only?: AssetPick[];
  onPick: (kind: AssetPick) => void;
  onImportFile: (file: File) => void;
  onRestoreFile: (file: File) => void;
  onHelp: () => void;
  /** Called once when the screen appears, so this device is marked as a new account's. */
  onMount: () => void;
  items: ChecklistItem[];
  actions: ChecklistActions;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  useEffect(onMount, [onMount]);
  // On a phone the checklist folds to one line; on a wide screen it is always open beside the import card.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width:900px)').matches);
  const { done, total, next } = checklistProgress(items);
  return (
    <div className="ob-start">
      <ol className="ob-steps" aria-label="Setup progress">
        <li data-done="">
          <Check size={12} aria-hidden="true" /> Vault password
        </li>
        <li data-done="">
          <Check size={12} aria-hidden="true" /> Recovery key saved
        </li>
        <li data-current="" aria-current="step">
          <b aria-hidden="true">3</b> Add what you own
        </li>
        <li className="ob-steps-note">
          <ShieldCheck size={14} aria-hidden="true" /> Everything you add is encrypted on this device before it is saved.
        </li>
      </ol>
      <div className="ob-start-grid">
        <div className="ob-main">
          <section className="slab ob-lead" aria-labelledby="ob-lead-h">
            <p className="lbl">Fastest · about 2 minutes</p>
            <h2 id="ob-lead-h">Import your broker statement</h2>
            <p className="ob-lead-copy">
              Sipwise reads your buys, sales and holdings from the statement on this device, then shows you everything to
              check before anything is saved.
            </p>
            <ul className="ob-brokers" aria-label="Statements we read">
              {BROKERS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div className="ob-lead-act">
              <button type="button" data-slot="ob-btn" className="ob-btn ob-btn--lg" disabled={disabled} onClick={() => importRef.current?.click()}>
                <FileUp size={16} aria-hidden="true" /> Choose a statement
              </button>
              <span>
                PDF, CSV or Excel ·{' '}
                <button type="button" data-slot="ob-link" className="ob-link" onClick={onHelp}>
                  How does it work?
                </button>
              </span>
            </div>
            <input
              ref={importRef}
              type="file"
              accept={IMPORT_ACCEPT}
              hidden
              aria-label="Broker statement file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onImportFile(file);
              }}
            />
          </section>
          <section aria-labelledby="ob-hand-h">
            <h2 id="ob-hand-h" className="lbl ob-hand-h">
              Or add by hand
            </h2>
            <div className="ob-tiles">
              {ASSET_CHOICES.filter((c) => !only || only.includes(c.kind)).map(({ kind, label, hint, Icon }) => (
                <button key={kind} type="button" data-slot="ob-tile" className="ob-tile" disabled={disabled} onClick={() => onPick(kind)}>
                  <span className="ob-tile-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <b>{label}</b>
                  <small>{hint}</small>
                </button>
              ))}
              <button type="button" data-slot="ob-tile" className="ob-tile ob-tile--dash" disabled={disabled} onClick={() => restoreRef.current?.click()}>
                <span className="ob-tile-icon" aria-hidden="true">
                  <RotateCcw size={18} />
                </span>
                <b>Restore a backup</b>
                <small>From a Sipwise backup file.</small>
              </button>
              <input
                ref={restoreRef}
                type="file"
                accept="application/json,.json"
                hidden
                aria-label="Sipwise backup file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onRestoreFile(file);
                }}
              />
            </div>
          </section>
        </div>
        <details className="ob-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            <Ring done={done} total={total} />
            <span>
              <b>Getting started</b>
              <small>{next ? `Next: ${next.label.toLowerCase()}` : 'All done'}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <ChecklistCard items={items} actions={actions} />
        </details>
      </div>
    </div>
  );
}

/** A one-time note at the top of a page the first time it is opened. Dismissed for good with "Got it". */
export function PageTip({ id, onDismiss }: { id: TipId; onDismiss: () => void }) {
  const tip = PAGE_TIPS[id];
  return (
    <aside className="ob-tip" aria-label="Tip">
      <div>
        <b>{tip.title}</b>
        <span>{tip.text}</span>
      </div>
      <button type="button" data-slot="ob-btn" className="ob-btn ob-btn--sec" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
