'use client';
import { useState } from 'react';
import { assessAll } from '@/lib/decision';
import {
  DEFAULT_RESEARCH_POLICY,
  today,
  type Portfolio,
  type ResearchPolicy,
} from '@/lib/portfolio';

type Props = {
  portfolio: Portfolio;
  save: (next: Portfolio, message?: string) => Promise<void>;
  busy: boolean;
};

export default function PolicyPreview({ portfolio, save, busy }: Props) {
  const [draft, setDraft] = useState<ResearchPolicy>(
    portfolio.researchPolicy ?? DEFAULT_RESEARCH_POLICY,
  );
  const active = portfolio.researchPolicy?.enabled ?? false;
  const assessments = assessAll(portfolio, draft, today());
  const eligible = assessments.filter((a) => a.eligible);
  const excluded = assessments.filter((a) => !a.eligible);
  return (
    <section className="policy-preview">
      <h3>Research-driven policy preview</h3>
      <p className="muted">
        This preview uses the settings below, not your saved policy — nothing
        here changes today&apos;s SIP suggestions above until you activate it.
        The research-driven column adds stance, Shariah screening, an
        approved maximum price and sector limits on top of the existing
        target gaps. Activating it switches the Monthly SIP tab to this
        research-driven eligibility and allocation; it never touches your
        saved holdings, targets or research conclusions.
      </p>
      <div className="form-grid">
        <label>
          Sector allocation limit (%)
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={draft.sectorCapPct}
            onChange={(e) =>
              setDraft({ ...draft, sectorCapPct: Number(e.target.value) })
            }
          />
        </label>
        <label className="check-row wide">
          <input
            type="checkbox"
            checked={draft.quoteFreshness === 'dated'}
            onChange={(e) =>
              setDraft({
                ...draft,
                quoteFreshness: e.target.checked ? 'dated' : 'today',
                maxQuoteAgeDays: e.target.checked ? 3 : null,
              })
            }
          />{' '}
          Accept quotes up to a maximum age instead of requiring today&apos;s
          price
        </label>
        {draft.quoteFreshness === 'dated' && (
          <label>
            Maximum quote age (days)
            <input
              type="number"
              min="1"
              step="1"
              value={draft.maxQuoteAgeDays ?? 3}
              onChange={(e) =>
                setDraft({ ...draft, maxQuoteAgeDays: Number(e.target.value) })
              }
            />
          </label>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Stance</th>
            <th>Eligible under research-driven policy</th>
            <th>Why not</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.ticker}>
              <td>{a.ticker}</td>
              <td>{a.stance}</td>
              <td>{a.eligible ? 'Yes' : 'No'}</td>
              <td>{a.exclusionReasons.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {eligible.length} of {assessments.length} companies would currently
        qualify for a new research-driven contribution; {excluded.length}{' '}
        would be excluded, with reasons shown above.
      </p>
      <p className="muted">
        {active
          ? 'The research-driven policy is active. The Monthly SIP tab above now uses this eligibility and allocation instead of the plain target-based calculation.'
          : 'The research-driven policy is not active. Activating it saves this setting and switches the Monthly SIP tab above from the plain target-based calculation to this eligibility and allocation.'}
      </p>
      <button
        disabled={busy}
        onClick={() =>
          save(
            { ...portfolio, researchPolicy: { ...draft, enabled: !active } },
            active
              ? 'Research-driven policy deactivated.'
              : 'Research-driven policy setting activated. This does not change today’s SIP suggestions yet.',
          )
        }
      >
        {active
          ? 'Deactivate research-driven policy'
          : 'Activate research-driven policy'}
      </button>
    </section>
  );
}
