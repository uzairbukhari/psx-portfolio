// Persisted, truthful progress for a Monthly Picks run. Every value here is written by the
// run processor when real work completes (a phase milestone, or one more company gathered);
// nothing is derived from elapsed time, so a stalled run shows a stalled bar.

export const PROGRESS_STEPS = [
  { key: 'validating', label: 'Validating inputs' },
  { key: 'gathering', label: 'Gathering evidence' },
  { key: 'metrics', label: 'Calculating metrics and portfolio limits' },
  { key: 'ai', label: 'AI analysis' },
  { key: 'allocating', label: 'Validating and allocating' },
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
  /** Times a step failed and was retried. */
  retries: number;
  /** Finished (or will finish) on partial evidence or a fallback ranking. */
  degraded: boolean;
  /** Plain-language note: waiting reason, retry state, or why the run is degraded. */
  message: string | null;
  updatedAt: string;
};

export function newProgress(total: number, now: string): RunProgress {
  return { step: 'validating', completed: 0, total, pending: [], retries: 0, degraded: false, message: null, updatedAt: now };
}

export function withStep(progress: RunProgress, step: ProgressStepKey, now: string, patch: Partial<RunProgress> = {}): RunProgress {
  return { ...progress, ...patch, step, updatedAt: now };
}

/**
 * Milestone percentage. Gathering is the only step that moves inside its band, and only with real
 * company counts. The AI step is indeterminate (`null`-like: it reports its milestone, not a
 * moving estimate). Only a persisted successful result (`saved`) reaches 100.
 */
export function progressPercent(progress: RunProgress): number {
  switch (progress.step) {
    case 'validating': return 5;
    case 'gathering': {
      const share = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0;
      return Math.round(10 + share * 30);
    }
    case 'metrics': return 45;
    case 'ai': return 50;
    case 'allocating': return 90;
    case 'saved': return 100;
  }
}

/** The AI step has no measurable fraction while the provider works. */
export const isIndeterminate = (progress: RunProgress) => progress.step === 'ai';

export function parseProgress(raw: string | null): RunProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RunProgress>;
    if (!value || !PROGRESS_STEPS.some((s) => s.key === value.step)) return null;
    return {
      step: value.step as ProgressStepKey,
      completed: Number.isFinite(value.completed) ? Number(value.completed) : 0,
      total: Number.isFinite(value.total) ? Number(value.total) : 0,
      pending: Array.isArray(value.pending) ? value.pending.filter((t): t is string => typeof t === 'string') : [],
      retries: Number.isFinite(value.retries) ? Number(value.retries) : 0,
      degraded: Boolean(value.degraded),
      message: typeof value.message === 'string' ? value.message : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch { return null; }
}
