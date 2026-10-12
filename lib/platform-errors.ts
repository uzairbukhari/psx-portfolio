// Recognises the HTML error pages Cloudflare (not this app) answers with when a Worker is over a platform limit or the
// platform is struggling. The app's own errors are always JSON, so a non-JSON failure body is the platform's. Pure module
// (no Workers imports) so the web app, the phone app and the tests share it.

export const PLATFORM_CODES = ['cf_worker_limit', 'cf_daily_limit', 'cf_rate_limited', 'cf_timeout', 'cf_unavailable'] as const;
export type PlatformCode = (typeof PLATFORM_CODES)[number];

export const PLATFORM_MESSAGES: Record<PlatformCode, string> = {
  cf_worker_limit: 'Sipwise is busy right now. Please try again in a minute.',
  cf_daily_limit: 'Sipwise has reached its daily capacity. It resets within a day; please try again later.',
  cf_rate_limited: 'Too many requests. Please wait a moment and try again.',
  cf_timeout: 'Sipwise took too long to answer. Please try again.',
  cf_unavailable: 'This is temporarily unavailable. Please try again shortly.',
};

/**
 * `status` and the start of `text` of a response that was not JSON, mapped to a platform code. Returns null for a
 * successful response, for a JSON body (the app's own answer) and for anything that is not clearly a platform page.
 */
export function classifyPlatformResponse(status: number, text: string): PlatformCode | null {
  if (status > 0 && status < 400) return null;
  const body = String(text ?? '').slice(0, 4000);
  if (/^\s*[[{]/.test(body)) return null;
  if (/1027|free tier|daily request limit|exceeded.*(daily|request) limit/i.test(body)) return 'cf_daily_limit';
  if (/1102|exceeded resource limits|exceeded (cpu|memory)|resource limits/i.test(body)) return 'cf_worker_limit';
  if (status === 429 || /1015|rate.?limited/i.test(body)) return 'cf_rate_limited';
  if (status === 504 || status === 522 || status === 523 || status === 524 || /\b52[234]\b|timed out/i.test(body)) return 'cf_timeout';
  if (status === 502 || status === 503 || status === 520 || status === 521 || status === 530 || /cloudflare|error code:? *5\d\d/i.test(body)) return 'cf_unavailable';
  return null;
}
