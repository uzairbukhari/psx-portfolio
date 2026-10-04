/**
 * Reads a fetch Response as JSON without ever throwing. Cloudflare answers with an HTML error page (for
 * example "Worker exceeded resource limits") instead of JSON when a Worker is overloaded; callers then get
 * `{ error }` so they can show a calm message or keep the last data instead of "Unexpected token '<'".
 */
export const UNAVAILABLE_MESSAGE = 'This is temporarily unavailable. Please try again shortly.';

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { error: UNAVAILABLE_MESSAGE };
  }
}
