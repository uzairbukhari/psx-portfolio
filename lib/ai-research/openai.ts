// OpenAI Responses API adapter: strict JSON-schema output, optional web search restricted to an allowlist.
import { outputCeiling, type AiConfig } from './models.ts';
import { parseJsonOutput, ProviderError, withRetries, type AiProvider, type AiRequest, type AiResponse } from './provider.ts';

type OutputItem = { type?: string; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] };
type ResponsesBody = {
  status?: string; output?: OutputItem[]; error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null; model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

export function openaiProvider(config: AiConfig, apiKey: string, fetchImpl: typeof fetch = fetch): AiProvider {
  async function once(request: AiRequest): Promise<AiResponse> {
    const model = config.models[request.role];
    const body: Record<string, unknown> = {
      model,
      instructions: request.system,
      input: request.input,
      store: false,
      max_output_tokens: outputCeiling(config, request.role, request.maxOutputTokens),
      reasoning: { effort: config.effort[request.role] },
      text: { format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: true } },
    };
    if (request.webSearch) {
      body.tools = [{ type: 'web_search', filters: { allowed_domains: request.webSearch.domains } }];
      body.max_tool_calls = request.webSearch.maxUses;
    }
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(480_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new ProviderError(`OpenAI answered ${response.status}: ${detail}`, response.status === 429 || response.status >= 500);
    }
    const data = (await response.json()) as ResponsesBody;
    if (data.status === 'failed' || data.error) throw new ProviderError(data.error?.message ?? 'OpenAI reported a failure.');
    if (data.status === 'incomplete') throw new ProviderError(`OpenAI stopped early (${data.incomplete_details?.reason ?? 'unknown'}).`);
    const items = data.output ?? [];
    const text = items.flatMap((item) => item.content ?? []).filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('');
    const sources = new Map<string, string>();
    for (const part of items.flatMap((item) => item.content ?? []))
      for (const note of part.annotations ?? []) if (note.type === 'url_citation' && note.url) sources.set(note.url, note.title ?? note.url);
    return {
      json: parseJsonOutput(text),
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cachedTokens: data.usage?.input_tokens_details?.cached_tokens ?? 0,
        searches: items.filter((item) => item.type === 'web_search_call').length,
      },
      sources: [...sources].map(([url, title]) => ({ url, title })),
    };
  }
  return { id: 'openai', call: (request) => withRetries(() => once(request)) };
}
