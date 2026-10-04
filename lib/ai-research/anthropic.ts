// Claude adapter (the switch): Anthropic TypeScript SDK, adaptive thinking, structured output and the dynamic-filtering
// web search tool restricted to an allowlist. Loaded only when AI_RESEARCH_PROVIDER=anthropic.
import Anthropic from '@anthropic-ai/sdk';
import type { AiConfig } from './models.ts';
import { parseJsonOutput, ProviderError, withRetries, type AiProvider, type AiRequest, type AiResponse } from './provider.ts';

export function anthropicProvider(config: AiConfig, apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  async function once(request: AiRequest): Promise<AiResponse> {
    const model = config.models[request.role];
    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: request.maxOutputTokens,
        // The fixed system prompt is cached across the many calls of one run.
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.input }],
        thinking: { type: 'adaptive' },
        output_config: { effort: config.effort[request.role], format: { type: 'json_schema', schema: request.schema } },
        ...(request.webSearch
          ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: request.webSearch.maxUses, allowed_domains: request.webSearch.domains }] }
          : {}),
      } as Anthropic.MessageCreateParamsNonStreaming;
      // Streaming avoids request timeouts on long, tool-using calls; only the final message is needed.
      const message = await client.messages.stream(params as unknown as Anthropic.MessageStreamParams).finalMessage();
      if (message.stop_reason === 'refusal') throw new ProviderError('The model declined this request.');
      if (message.stop_reason === 'max_tokens') throw new ProviderError('The model ran out of output tokens.');
      const text = message.content.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).join('');
      const sources = new Map<string, string>();
      for (const block of message.content) {
        const results = (block as { type: string; content?: unknown }).type === 'web_search_tool_result' ? (block as { content?: unknown }).content : null;
        if (Array.isArray(results)) for (const hit of results as { url?: string; title?: string }[]) if (hit.url) sources.set(hit.url, hit.title ?? hit.url);
      }
      const usage = message.usage as unknown as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };
      const cached = usage.cache_read_input_tokens ?? 0;
      return {
        json: parseJsonOutput(text),
        model: message.model,
        usage: {
          inputTokens: (usage.input_tokens ?? 0) + cached + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          cachedTokens: cached,
          searches: usage.server_tool_use?.web_search_requests ?? 0,
        },
        sources: [...sources].map(([url, title]) => ({ url, title })),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Anthropic.RateLimitError || (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500))
        throw new ProviderError(error.message, true);
      throw new ProviderError(error instanceof Error ? error.message : 'Claude request failed.');
    }
  }
  return { id: 'anthropic', call: (request) => withRetries(() => once(request)) };
}
