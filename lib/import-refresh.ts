import {
  followQuoteJob,
  isPending,
  isProblem,
  jobMessage,
  type QuoteFollow,
} from './quote-refresh-client.ts';
/** A public-cache operation only: import success and its revision are never changed by a refresh. */
export async function refreshImportQuotes(options: QuoteFollow) {
  const response = await followQuoteJob(options);
  if (options.cancelled?.()) return response;
  if (isPending(response.job) || isProblem(response.job))
    throw new Error(jobMessage(response.job));
  return response;
}
