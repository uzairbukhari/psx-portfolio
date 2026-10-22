'use client';
// Future you: its own page. Where the monthly SIP leads, and what-ifs to compare against it. Everything is worked out
// here from the decrypted plan and ledger; nothing leaves the device.
import { today } from '@/lib/portfolio';
import { SIP_CLASSES, type SipBlueprint } from '@/lib/sip-blueprint';
import { classWeights, type SipRates } from '@/lib/sip-blueprint-data';
import { SipFuture } from './sip-tracker-future';

export default function FutureYou({
  parts,
  blueprint,
  rates,
  busy,
  onSave,
  onOpenBlueprint,
}: {
  parts: Parameters<typeof classWeights>[0];
  blueprint: SipBlueprint | null;
  rates: SipRates;
  busy: boolean;
  onSave: (next: SipBlueprint, message: string) => Promise<unknown>;
  onOpenBlueprint: () => void;
}) {
  if (!blueprint)
    return (
      <div className="sp-page">
        <section className="panel sp-card">
          <h2>Set up your SIP first</h2>
          <p className="sp-sub">Future you starts from your monthly amount and the mix you chose. It only takes a minute.</p>
          <button type="button" className="compact" onClick={onOpenBlueprint}>
            Open SIP Blueprint
          </button>
        </section>
      </div>
    );
  const held = classWeights(parts, today(), rates).values;
  return (
    <div className="sp-page sp-page-single">
      <SipFuture
        b={blueprint}
        busy={busy}
        held={SIP_CLASSES.reduce((n, k) => n + held[k], 0)}
        onSave={(patch) => onSave({ ...blueprint, ...patch }, 'Assumptions saved.')}
      />
    </div>
  );
}
