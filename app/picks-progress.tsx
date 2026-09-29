'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { Recommendation } from './use-recommendations';

const STEPS = [
  { key: 'gathering', label: 'Gathering PSX data', detail: 'Fetching company financials from PSX' },
  { key: 'ranking', label: 'Ranking companies', detail: 'Scoring and AI ranking of your shortlist' },
  { key: 'ready', label: 'Ready', detail: 'Picks and allocations' },
] as const;

function elapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function PicksProgress({ run }: { run: Recommendation }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const phase = run.progress?.phase ?? 'ranking';
  const activeIndex = phase === 'gathering' ? 0 : 1;
  const pending = run.progress?.pending ?? [];

  return (
    <section className="mp-progress" aria-live="polite" aria-busy="true">
      <ol className="mp-steps">
        {STEPS.map((step, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
          return (
            <li key={step.key} className={`mp-step mp-step--${state}`}>
              <span className="mp-step__dot">
                {state === 'done' ? <Check size={14} /> : state === 'active' ? <Loader2 className="spin" size={14} /> : index + 1}
              </span>
              <span className="mp-step__text"><b>{step.label}</b><small>{step.detail}</small></span>
            </li>
          );
        })}
      </ol>
      <div className="mp-progress__meta">
        <span>Elapsed {elapsed(run.progress?.startedAt ?? run.createdAt, now)}</span>
        {phase === 'gathering' && pending.length > 0 && <span>Waiting on {pending.join(', ')}</span>}
        <span>Safe to leave this page — the run is saved and resumes when you return.</span>
      </div>
    </section>
  );
}
