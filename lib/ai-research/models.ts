// Provider/model selection and list prices for the monthly cost ledger. Prices are USD per million tokens as
// published when this was written; verify against the provider's pricing page before relying on the cap's margin.
import type { ModelRole, Provider } from './types.ts';

export type ModelPrice = { input: number; cachedInput: number; output: number };
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'claude-sonnet-5-5': { input: 2, cachedInput: 0.2, output: 10 },
  'claude-opus-5-5': { input: 4, cachedInput: 0.2, output: 20 },
};
/** Web search is billed per call by both providers (USD per 1,000 calls). */
export const SEARCH_USD_PER_CALL = 10 / 1000;
/** Used when a configured model is not in the table: pessimistic so the cap still holds. */
const UNKNOWN_PRICE: ModelPrice = { input: 5, cachedInput: 0.5, output: 25 };

export type AiConfig = {
  provider: Provider;
  models: Record<ModelRole, string>;
  effort: Record<ModelRole, 'low' | 'medium' | 'high'>;
  monthlyCapUsd: number;
  enabled: boolean;
};

const DEFAULTS: Record<Provider, { models: Record<ModelRole, string>; effort: Record<ModelRole, 'low' | 'medium' | 'high'> }> = {
  openai: { models: { read: 'gpt-5-mini', rank: 'gpt-5' }, effort: { read: 'medium', rank: 'high' } },
  anthropic: { models: { read: 'claude-sonnet-5-5', rank: 'claude-opus-5-5' }, effort: { read: 'medium', rank: 'high' } },
};

type Env = { AI_RESEARCH_PROVIDER?: string; AI_RESEARCH_MODEL_READ?: string; AI_RESEARCH_MODEL_RANK?: string; AI_RESEARCH_MONTHLY_CAP_USD?: string; AI_LAB_ENABLED?: string };

/** Reads the AI_RESEARCH_* settings. Unknown providers and bad numbers fall back to safe defaults. */
export function resolveConfig(env: Env): AiConfig {
  const provider: Provider = env.AI_RESEARCH_PROVIDER?.trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const base = DEFAULTS[provider];
  const cap = Number(env.AI_RESEARCH_MONTHLY_CAP_USD);
  return {
    provider,
    models: {
      read: env.AI_RESEARCH_MODEL_READ?.trim() || base.models.read,
      rank: env.AI_RESEARCH_MODEL_RANK?.trim() || base.models.rank,
    },
    effort: base.effort,
    monthlyCapUsd: Number.isFinite(cap) && cap > 0 ? cap : 5,
    enabled: env.AI_LAB_ENABLED?.trim().toLowerCase() !== 'false',
  };
}

export const priceOf = (model: string): ModelPrice => MODEL_PRICES[model] ?? UNKNOWN_PRICE;

export type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; searches: number };

/** Exact cost of a finished call. Cached tokens are a subset of input tokens. */
export function costOf(model: string, usage: Usage): number {
  const price = priceOf(model);
  const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (fresh * price.input + usage.cachedTokens * price.cachedInput + usage.outputTokens * price.output) / 1e6 +
    usage.searches * SEARCH_USD_PER_CALL;
}

/** Worst case for a call about to be made: all input uncached, the full output allowance, every search used. */
export function worstCaseCost(model: string, inputTokens: number, maxOutputTokens: number, maxSearches: number): number {
  return costOf(model, { inputTokens, outputTokens: maxOutputTokens, cachedTokens: 0, searches: maxSearches });
}

/** Rough token estimate (about 3.5 characters per token for English text and JSON) with a safety margin. */
export const estimateTokens = (text: string): number => Math.ceil((text.length / 3.5) * 1.15);
