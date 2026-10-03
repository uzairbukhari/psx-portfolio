// Truthful progress for a Monthly Picks run on the device. Every value is set when real work completes
// (a phase milestone, or the company data that has arrived); nothing is derived from elapsed time, so a
// stalled run shows a stalled bar.

export const PROGRESS_STEPS = [
  { key: 'validating', label: 'Validating inputs' },
  { key: 'gathering', label: 'Gathering public company data' },
  { key: 'metrics', label: 'Calculating metrics' },
  { key: 'allocating', label: 'Ranking and applying your limits on this device' },
  { key: 'saved', label: 'Saved' },
] as const;
export type ProgressStepKey = (typeof PROGRESS_STEPS)[number]['key'];

export type RunProgress = {
  step: ProgressStepKey;
  /** Companies whose evidence has arrived / total in the shortlist (gathering step). */
  completed: number;
  total: number;
  /** Symbols still waiting on a scrape. */
  pending: string[];
  /** Finished (or will finish) on partial evidence. */
  degraded: boolean;
  /** Plain-language note: waiting reason, or why the run is degraded. */
  message: string | null;
  startedAt: string;
  updatedAt: string;
  percent: number;
};

export function newProgress(total: number, now: string): RunProgress {
  return { step: 'validating', completed: 0, total, pending: [], degraded: false, message: null, startedAt: now, updatedAt: now, percent: 5 };
}

/**
 * Milestone percentage. Gathering is the only step that moves inside its band, and only with real
 * company counts. Only a persisted successful result (`saved`) reaches 100.
 */
export function progressPercent(progress: Pick<RunProgress, 'step' | 'completed' | 'total'>): number {
  switch (progress.step) {
    case 'validating': return 5;
    case 'gathering': {
      const share = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0;
      return Math.round(10 + share * 40);
    }
    case 'metrics': return 60;
    case 'allocating': return 85;
    case 'saved': return 100;
  }
}

export function withStep(progress: RunProgress, step: ProgressStepKey, now: string, patch: Partial<RunProgress> = {}): RunProgress {
  const next = { ...progress, ...patch, step, updatedAt: now };
  return { ...next, percent: progressPercent(next) };
}
