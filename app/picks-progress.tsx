'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { PROGRESS_STEPS } from '@/lib/monthly-picks-progress';
import type { Recommendation } from './use-recommendations';

function elapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Shows the run's persisted progress. Every number comes from the server (a phase milestone plus real
 * company counts); the clock below only reports elapsed time and never moves the bar.
 */
export default function PicksProgress({ run }: { run: Recommendation }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const progress = run.progress;
  // Runs from before persisted progress only know gathering vs ranking.
  const step = progress?.step ?? (progress?.phase === 'gathering' ? 'gathering' : 'ai');
  const activeIndex = Math.max(0, PROGRESS_STEPS.findIndex((s) => s.key === step));
  const pending = progress?.pending ?? [];
  const percent = progress?.percent;

  return (
    <section className="mp-progress" aria-live="polite" aria-busy="true">
      {percent !== undefined && (
        <progress
          className="mp-bar"
          max={100}
          value={progress?.indeterminate ? undefined : percent}
          aria-label="Monthly Picks progress"
        />
      )}
      <ol className="mp-steps">
        {PROGRESS_STEPS.map((s, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
          const detail = s.key === 'gathering' && progress?.total
            ? `${progress.completed ?? 0} of ${progress.total} companies`
            : s.key === 'ai' && state === 'active' ? 'Waiting for the AI provider' : '';
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
        <span>Elapsed {elapsed(progress?.startedAt ?? run.createdAt, now)}</span>
        {pending.length > 0 && <span>Waiting on {pending.join(', ')}</span>}
        {!!progress?.retries && <span>Retried {progress.retries} time{progress.retries === 1 ? '' : 's'}</span>}
        {progress?.degraded && <span>Continuing with partial evidence</span>}
        {progress?.message && <span>{progress.message}</span>}
        <span>Safe to leave this page: the run continues on the server and the result is saved.</span>
      </div>
    </section>
  );
}
