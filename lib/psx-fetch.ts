const UA = { 'User-Agent': 'Mozilla/5.0 PSX Portfolio Dashboard/1.0' };
const TIMEOUT = 10_000;
const RETRIES = 2;
const RETRY_DELAY_MS = 400;
const MAX_RETRY_AFTER_MS = 3_000;

/**
 * Shared per-invocation fetch allowance. Cloudflare Workers cap outgoing
 * subrequests per invocation (50 on the free plan) — every attempt, including
 * retries, spends one, so callers that fan out share a budget and stop early
 * instead of dying with "Too many subrequests".
 */
export interface FetchBudget {
  left: number;
}

export function fetchBudget(left: number): FetchBudget {
  return { left };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const retryable = (status: number) => status === 429 || status >= 500;

/**
 * dps.psx.com.pk intermittently answers a small fraction of requests with a
 * transient 5xx (seen in production as "520 from PSX") that succeeds on
 * an immediate retry — this wraps every PSX fetch so callers don't have to.
 * 4xx other than 429 (e.g. a removed endpoint's 404, or a WAF 403) is final:
 * retrying only burns subrequests.
 */
export async function fetchPsx(url: string, budget?: FetchBudget): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (budget) {
      if (budget.left <= 0)
        throw lastError ?? Error('PSX request budget exhausted for this refresh');
      budget.left--;
    }
    let delay = RETRY_DELAY_MS * (attempt + 1);
    try {
      const response = await fetch(url, {
        headers: UA,
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (response.ok) return response;
      lastError = Error(`${response.status} from PSX`);
      if (!retryable(response.status)) throw lastError;
      const retryAfter = Number(response.headers.get('Retry-After'));
      if (Number.isFinite(retryAfter) && retryAfter > 0)
        delay = Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
    } catch (error) {
      if (error === lastError) throw error;
      lastError = error;
    }
    if (attempt < RETRIES) await sleep(delay);
  }
  throw lastError;
}
