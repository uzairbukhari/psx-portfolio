import { classifyPlatformResponse, PLATFORM_MESSAGES, type PlatformCode } from './platform-errors.ts';

/**
 * Reads a fetch Response as JSON without ever throwing. Cloudflare answers with an HTML error page (for
 * example "Worker exceeded resource limits") instead of JSON when a Worker is overloaded; callers then get
 * `{ error }` so they can show a calm message or keep the last data instead of "Unexpected token '<'".
 * A page recognised as Cloudflare's also tells the registered listener which limit was hit (for the audit log).
 */
export const UNAVAILABLE_MESSAGE = PLATFORM_MESSAGES.cf_unavailable;

type Listener = (code: PlatformCode) => void;
const listeners = new Set<Listener>();
/** Registers a callback for platform error pages seen by `readJson`; returns the unsubscribe function. */
export function onPlatformError(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function readJson(response: Response): Promise<unknown> {
  let text = '';
  try {
    text = await response.text();
    return JSON.parse(text);
  } catch {
    const code = classifyPlatformResponse(response.status, text);
    if (code) for (const listener of listeners) { try { listener(code); } catch { /* a listener must not break the caller */ } }
    return { error: code ? PLATFORM_MESSAGES[code] : UNAVAILABLE_MESSAGE, ...(code ? { platform: code } : {}) };
  }
}
