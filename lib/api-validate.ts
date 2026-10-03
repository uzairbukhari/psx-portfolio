// Runtime checks at the API boundary: TypeScript types vanish at runtime, so a client validates what a
// server (or an older/newer deployment) actually sent before rendering it. Returns null when unusable.
import type { PublicAnalysisResponse } from './api-types.ts';

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function parsePublicAnalysis(value: unknown): PublicAnalysisResponse | null {
  if (!isObject(value)) return null;
  if (typeof value.dataAsOf !== 'string' || !Array.isArray(value.companies) || !Array.isArray(value.scores) || !Array.isArray(value.facts)) return null;
  if (!value.companies.every((c) => isObject(c) && typeof c.ticker === 'string' && isObject(c.metrics))) return null;
  if (!value.scores.every((s) => isObject(s) && typeof s.ticker === 'string')) return null;
  if (!value.facts.every((f) => isObject(f) && typeof f.ticker === 'string' && typeof f.state === 'string')) return null;
  return {
    dataAsOf: value.dataAsOf,
    companies: value.companies as PublicAnalysisResponse['companies'],
    scores: value.scores as PublicAnalysisResponse['scores'],
    index: isObject(value.index) ? (value.index as PublicAnalysisResponse['index']) : null,
    facts: value.facts as PublicAnalysisResponse['facts'],
    factsMaxAgeDays: Number.isFinite(value.factsMaxAgeDays) ? Number(value.factsMaxAgeDays) : 7,
    dispatchEnabled: Boolean(value.dispatchEnabled),
  };
}

/** Poll interval while waiting for an on-demand company-data scrape: 5 s, easing to 15 s after one minute. */
export const pollIntervalMs = (elapsedMs: number) => (elapsedMs < 60_000 ? 5_000 : 15_000);
