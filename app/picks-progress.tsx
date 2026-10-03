'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { PROGRESS_STEPS } from '@/lib/monthly-picks-progress';
import type { RunProgress } from '@/lib/monthly-picks-progress';

function elapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Shows the run's progress. Every number is a phase milestone plus real company counts; the clock below only
 * reports elapsed time and never moves the bar.
 */
export default function PicksProgress({ progress }: { progress: RunProgress }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const activeIndex = Math.max(0, PROGRESS_STEPS.findIndex((s) => s.key === progress.step));
  const pending = progress.pending;

  return (
    <section className="mp-progress" aria-live="polite" aria-busy="true">
      <progress className="mp-bar" max={100} value={progress.percent} aria-label="Monthly Picks progress" />
      <ol className="mp-steps">
        {PROGRESS_STEPS.map((s, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
          const detail = s.key === 'gathering' && progress.total
            ? `${progress.completed} of ${progress.total} companies`
            : '';
          return (
            <li key={s.key} className={`mp-step mp-step--${state}`}>
              <span className="mp-step__dot">
                {state === 'done' ? <Check size={14} /> : state === 'active' ? <Loader2 className="spin" size={14} /> : index + 1}
              </span>
              <span className="mp-step__text"><b>{s.label}</b>{detail && <small>{detail}</small>}</span>
            </li>
          );
        })}
      </ol>
      <div className="mp-progress__meta">
        <span>Elapsed {elapsed(progress.startedAt, now)}</span>
        {pending.length > 0 && <span>Waiting on {pending.join(', ')}</span>}
        {progress.degraded && <span>Continuing with partial evidence</span>}
        {progress.message && <span>{progress.message}</span>}
        <span>Keep this page open: the ranking is calculated and saved on this device.</span>
      </div>
    </section>
  );
}
