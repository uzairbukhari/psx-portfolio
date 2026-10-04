'use client';

import { useMemo } from 'react';
import { ExternalLink, Loader2, Microscope } from 'lucide-react';
import { holdings, type Portfolio } from '@/lib/portfolio';
import { reviewHoldings } from '@/lib/holdings-review';
import type { HoldingAction } from '@/lib/ai-lab-types';
import type { PublicResearch } from '@/lib/ai-research/types';
import type { ResearchState } from './use-ai-lab';

const LABEL: Record<HoldingAction, string> = { keep: 'Keep', add: 'Add', trim: 'Trim', sell: 'Sell', review: 'Needs research' };

type Props = {
  portfolio: Portfolio;
  research: PublicResearch;
  stateOf: (ticker: string) => ResearchState;
  requesting: boolean;
  enabled: boolean;
  chosen: string[];
  onToggle: (ticker: string) => void;
  picked: string[];
  onResearchPicked: () => void;
  onOpenCompany: (ticker: string) => void;
};

/** Combines the public research with the user's own positions. The position data stays on this device. */
export default function AiLabHoldings({ portfolio, research, stateOf, requesting, enabled, chosen, onToggle, picked, onResearchPicked, onOpenCompany }: Props) {
  const suggestions = useMemo(() => {
    const positions = holdings(portfolio).filter((h) => h.shares > 0)
      .map((h) => ({ ticker: h.ticker, name: h.name, shares: h.shares, value: h.value, price: h.quote?.price ?? null, cost: h.cost }));
    return reviewHoldings(positions, research);
  }, [portfolio, research]);

  if (!suggestions.length) return <section className="ai-lab__panel"><p className="muted">You hold nothing yet, so there is nothing to review.</p></section>;
  return (
    <section className="ai-lab__panel">
      <div className="ai-lab__holdings-head">
        <div>
          <h3>Holdings review</h3>
          <p className="muted">Keep, add, trim or sell for each company you hold. The AI judges the company from public data; your weight, gain and the 20% limit are applied here on your device. Advice only: nothing is sold for you.</p>
        </div>
        {picked.length > 0 && (
          <button type="button" className="secondary" disabled={!enabled || requesting} onClick={onResearchPicked}>
            {requesting ? <Loader2 className="spin" size={16} /> : <Microscope size={16} />} Research selected ({picked.length})
          </button>
        )}
      </div>
      <div className="ai-lab__holdings">
        {suggestions.map((s) => (
          <article key={s.ticker} className={`ai-lab__holding ai-lab__holding--${s.action}`}>
            <div className="ai-lab__holding-top">
              <div>
                <button type="button" className="link-button ticker" onClick={() => onOpenCompany(s.ticker)}>{s.ticker}</button>
                <small>{s.name}</small>
              </div>
              <span className="ai-lab__holding-side">
                {!['queued', 'researching'].includes(stateOf(s.ticker)) && (s.action === 'review' || stateOf(s.ticker) === 'stale') && (
                  <label className="ai-lab__tick"><input type="checkbox" checked={chosen.includes(s.ticker)} disabled={!enabled} onChange={() => onToggle(s.ticker)} /> Research</label>
                )}
                <span className={`ai-lab__action ai-lab__action--${s.action}`}>{LABEL[s.action]}</span>
              </span>
            </div>
            <div className="ai-lab__facts">
              {s.weightPct !== null && <span>{s.weightPct}% of portfolio</span>}
              {s.gainPct !== null && <span>{s.gainPct > 0 ? '+' : ''}{s.gainPct}% vs cost</span>}
              {s.conviction !== null && <span>conviction {s.conviction}/100</span>}
              {s.thesisState && <span>thesis {s.thesisState}</span>}
              {s.trimShares ? <span>sell about {s.trimShares} shares to reach 20%</span> : null}
            </div>
            <ul className="ai-lab__list">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {s.watch && <p className="ai-lab__watch"><b>What would change this:</b> {s.watch}</p>}
            {s.sources.length > 0 && (
              <div className="source-links">{s.sources.filter((x) => x.url).map((x) => <a key={x.url + x.label} href={x.url} target="_blank" rel="noreferrer">{x.label.slice(0, 60)} <ExternalLink size={12} /></a>)}</div>
            )}
            {s.researchedAt && <small>Researched {s.researchedAt.slice(0, 10)}{s.carriedForward ? ' (reused, nothing changed)' : ''}</small>}
          </article>
        ))}
      </div>
      <p className="muted ai-lab__small">Not investment advice. Capital gains tax is not calculated here.</p>
    </section>
  );
}
