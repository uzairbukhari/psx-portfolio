// One interface for the two model providers. The pipeline never knows which one it is talking to; the provider is
// chosen by AI_RESEARCH_PROVIDER (openai by default, anthropic as the switch).
import type { AiConfig, Usage } from './models.ts';
import type { ModelRole } from './types.ts';

export type AiRequest = {
  stage: string;
  role: ModelRole;
  system: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Omit for stages that must not browse (extraction, bear review, ranking). */
  webSearch?: { maxUses: number; domains: string[] };
};
export type AiResponse = {
  json: unknown;
  usage: Usage;
  model: string;
  /** URLs the provider's search returned or cited during the call. */
  sources: { url: string; title: string }[];
};
export interface AiProvider {
  readonly id: 'openai' | 'anthropic';
  call(request: AiRequest): Promise<AiResponse>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) { super(message); this.name = 'ProviderError'; this.retryable = retryable; }
}

/** Retries rate limits and 5xx with backoff; anything else is final. */
export async function withRetries<T>(task: () => Promise<T>, attempts = 3, baseMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await task(); } catch (error) {
      last = error;
      if (!(error instanceof ProviderError) || !error.retryable || i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** i));
    }
  }
  throw last;
}

export function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { throw new ProviderError('The model did not return valid JSON.'); }
}

export async function createProvider(config: AiConfig, secrets: { openaiKey?: string; anthropicKey?: string }): Promise<AiProvider> {
  if (config.provider === 'anthropic') {
    if (!secrets.anthropicKey) throw new Error('ANTHROPIC_API_KEY is required when AI_RESEARCH_PROVIDER=anthropic.');
    const { anthropicProvider } = await import('./anthropic.ts');
    return anthropicProvider(config, secrets.anthropicKey);
  }
  if (!secrets.openaiKey) throw new Error('OPENAI_API_KEY is required.');
  const { openaiProvider } = await import('./openai.ts');
  return openaiProvider(config, secrets.openaiKey);
}
