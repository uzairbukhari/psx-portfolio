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

/**
 * PSX serves the company Payouts table as an HTML fragment from
 * POST /company/payouts. It answers a "Not Found" page unless the request is
 * marked as AJAX (`X-Requested-With`) and carries the page's `X-Req-Id` token,
 * which the company page embeds as `window.__ps._k`. No cookie is needed.
 */
export async function fetchPsxPayoutsHtml(ticker: string, budget?: FetchBudget): Promise<string> {
  const page = await (await fetchPsx(`https://dps.psx.com.pk/company/${ticker}`, budget)).text();
  const token = /"_k":"([^"]+)"/.exec(page)?.[1];
  if (!token) throw Error('PSX company page carried no request token');
  if (budget) {
    if (budget.left <= 0) throw Error('PSX request budget exhausted for this refresh');
    budget.left--;
  }
  const response = await fetch('https://dps.psx.com.pk/company/payouts', {
    method: 'POST',
    headers: {
      ...UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Req-Id': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams({ symbol: ticker }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw Error(`${response.status} from PSX`);
  const html = await response.text();
  if (!html.includes('class="tbl"')) throw Error('PSX payouts response had no table');
  return html;
}

/** The per-page request token PSX embeds as `window.__ps._k` on every company page. */
export async function fetchPsxToken(ticker: string, budget?: FetchBudget): Promise<string> {
  const page = await (await fetchPsx(`https://dps.psx.com.pk/company/${ticker}`, budget)).text();
  const token = /"_k":"([^"]+)"/.exec(page)?.[1];
  if (!token) throw Error('PSX company page carried no request token');
  return token;
}

/**
 * `/timeseries/eod|int/<TICKER>` answers 404 unless marked as AJAX and given the
 * page token. Returns rows newest-first: eod [sec, close, volume, open], int [sec, price, volume].
 */
export async function fetchPsxTimeseries(
  ticker: string,
  kind: 'eod' | 'int',
  token: string,
  budget?: FetchBudget,
): Promise<number[][]> {
  if (budget) {
    if (budget.left <= 0) throw Error('PSX request budget exhausted for this refresh');
    budget.left--;
  }
  const response = await fetch(`https://dps.psx.com.pk/timeseries/${kind}/${ticker}`, {
    headers: { ...UA, 'X-Req-Id': token, 'X-Requested-With': 'XMLHttpRequest' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw Error(`${response.status} from PSX`);
  const body = (await response.json()) as { status: number; data: number[][] };
  if (body.status !== 1 || !Array.isArray(body.data))
    throw Error('Unexpected PSX timeseries response');
  return body.data;
}
