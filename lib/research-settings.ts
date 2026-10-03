// AI settings a research job runs with. The client sends them when it queues a job (they live in the encrypted
// portfolio, so the server cannot read them from there) and the server validates every field against the same
// allowlists and bounds the app itself enforces. Anything invalid falls back to the defaults; never trusted blindly.
import { DEFAULT_RESEARCH_SETTINGS, REASONING_EFFORTS, RESEARCH_MODELS, type ResearchSettings } from './portfolio.ts';

export function sanitizeResearchSettings(input: unknown): ResearchSettings {
  const s = input as Partial<ResearchSettings> | null | undefined;
  if (
    !s ||
    typeof s !== 'object' ||
    !RESEARCH_MODELS.includes(s.model as never) ||
    !REASONING_EFFORTS.includes(s.reasoningEffort as never) ||
    !Number.isFinite(s.maxOutputTokens) ||
    (s.maxOutputTokens as number) < 4000 ||
    (s.maxOutputTokens as number) > 64000 ||
    !Number.isFinite(s.budgetUsd) ||
    (s.budgetUsd as number) < 0.05 ||
    (s.budgetUsd as number) > 5 ||
    !Number.isInteger(s.maxAttempts) ||
    (s.maxAttempts as number) < 1 ||
    (s.maxAttempts as number) > 5
  )
    return DEFAULT_RESEARCH_SETTINGS;
  return {
    model: s.model as ResearchSettings['model'],
    reasoningEffort: s.reasoningEffort as ResearchSettings['reasoningEffort'],
    maxOutputTokens: s.maxOutputTokens as number,
    budgetUsd: s.budgetUsd as number,
    maxAttempts: s.maxAttempts as number,
  };
}

/** The settings stored with a job (JSON), or the defaults when none/invalid. */
export function settingsFromJob(stored: string | null): ResearchSettings {
  if (!stored) return DEFAULT_RESEARCH_SETTINGS;
  try {
    return sanitizeResearchSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_RESEARCH_SETTINGS;
  }
}
