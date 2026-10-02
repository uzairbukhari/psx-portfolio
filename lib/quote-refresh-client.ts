// Client-side follow-through of a manual price refresh: start it, then poll the job until it settles.
// Pure over injected `post`/`get`/`sleep`, so the web UI and the tests share it. Polling is read-only:
// stopping it (navigation, unmount) never cancels the server-side work, and a later page load resumes it.
import type { QuotesResponse } from './api-types.ts';
import { QUOTE_MESSAGES, type QuoteJob } from './quote-jobs.ts';

export const QUOTE_POLL_MS = 5_000;
/** The server fails a request after 20 minutes; the client gives up a little later. */
export const QUOTE_POLL_LIMIT_MS = 21 * 60_000;

export const isPending = (job?: QuoteJob) => job?.state === 'queued' || job?.state === 'running';
/** Failure-toned states: the user should see the message as a warning, not a success. */
export const isProblem = (job?: QuoteJob) => !job || job.state === 'partial' || job.state === 'failed' || job.state === 'unavailable';
export const jobMessage = (job?: QuoteJob) => job?.message ?? QUOTE_MESSAGES.failed;

export interface QuoteFollow {
  start?: () => Promise<QuotesResponse>;
  poll: (since: string | undefined) => Promise<QuotesResponse>;
  sleep?: (ms: number) => Promise<void>;
  cancelled?: () => boolean;
  now?: () => number;
  /** Called with each response while the job is pending (e.g. to show the pending message). */
  onPending?: (response: QuotesResponse) => void;
}

/** Resolves with the last response: settled, or still pending when cancelled or after the poll limit. */
export async function followQuoteJob({
  start, poll, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), cancelled = () => false, now = Date.now, onPending,
}: QuoteFollow): Promise<QuotesResponse> {
  const began = now();
  let response = await (start ?? (() => poll(undefined)))();
  while (isPending(response.job) && !cancelled() && now() - began < QUOTE_POLL_LIMIT_MS) {
    onPending?.(response);
    await sleep(QUOTE_POLL_MS);
    if (cancelled()) break;
    try {
      response = await poll(response.job?.requestedAt);
    } catch {
      // A dropped poll is not a failed refresh: keep waiting for the server's answer.
    }
  }
  return response;
}
