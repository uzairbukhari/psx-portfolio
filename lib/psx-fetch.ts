const UA = { 'User-Agent': 'Mozilla/5.0 PSX Portfolio Dashboard/1.0' };
const TIMEOUT = 20_000;
const RETRIES = 2;
const RETRY_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * dps.psx.com.pk intermittently answers a small fraction of requests with a
 * transient 5xx (seen in production as "520 from PSX") that succeeds on
 * an immediate retry — this wraps every PSX fetch so callers don't have to.
 */
export async function fetchPsx(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: UA,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (response.ok) return response;
      lastError = Error(`${response.status} from PSX`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
  throw lastError;
}
