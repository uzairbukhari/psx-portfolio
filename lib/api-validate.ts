// Runtime checks at the API boundary: TypeScript types vanish at runtime, so a client validates what a
// server (or an older/newer deployment) actually sent before rendering it. Returns null when unusable.
import type { RecommendationRun, RecommendationListResponse } from './api-types.ts';

const STATUSES = ['queued', 'gathering', 'in_progress', 'completed', 'failed', 'completed_partial', 'needs_evidence', 'needs_attention'];
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function parseRecommendationRun(value: unknown): RecommendationRun | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.month !== 'string' || !STATUSES.includes(String(value.status))) return null;
  if (!Number.isFinite(value.amount) || !Number.isFinite(value.feePct)) return null;
  if (!Array.isArray(value.shortlist) || !value.shortlist.every((t) => typeof t === 'string')) return null;
  if (value.result !== null && value.result !== undefined) {
    const r = value.result;
    if (!isObject(r) || !Array.isArray(r.picks) || !Array.isArray(r.coverage) || !Number.isFinite(r.unallocatedPct)) return null;
  }
  const progress = value.progress;
  if (progress !== undefined && (!isObject(progress) || !Array.isArray(progress.pending))) return null;
  if (isObject(progress) && progress.percent !== undefined && !(Number(progress.percent) >= 0 && Number(progress.percent) <= 100)) return null;
  return { result: null, error: null, ...value } as unknown as RecommendationRun;
}

export function parseRecommendationList(value: unknown): RecommendationListResponse | null {
  if (!isObject(value) || !Array.isArray(value.recommendations)) return null;
  const runs = value.recommendations.map(parseRecommendationRun);
  if (runs.some((run) => run === null)) return null;
  return {
    recommendations: runs as RecommendationRun[],
    facts: Array.isArray(value.facts) ? (value.facts as RecommendationListResponse['facts']) : [],
    dispatchEnabled: Boolean(value.dispatchEnabled),
    factsMaxAgeDays: Number.isFinite(value.factsMaxAgeDays) ? Number(value.factsMaxAgeDays) : 7,
    backgroundProcessing: Boolean(value.backgroundProcessing),
  };
}

/** Poll interval for an active run: 5 s, easing to 15 s after one minute. */
export const pollIntervalMs = (elapsedMs: number) => (elapsedMs < 60_000 ? 5_000 : 15_000);
