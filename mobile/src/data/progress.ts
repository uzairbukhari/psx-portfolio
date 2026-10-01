// Step-bar maths for the "this month" progress (pure): a row of equal steps that fill left to right.
export type StepState = 'done' | 'on' | 'todo';

/**
 * `fraction` (0..1) of `steps` segments: whole steps are done, a started step is "on" (in progress), the
 * rest are todo. At 100% every step is done.
 */
export function stepStates(fraction: number, steps = 6): StepState[] {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const filled = f * steps;
  const done = Math.floor(filled + 1e-9);
  return Array.from({ length: steps }, (_, i) => (i < done ? 'done' : i === done && filled - done > 1e-9 ? 'on' : 'todo'));
}
