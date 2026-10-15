package app.sipwise.network

import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable

@Serializable
data class QuoteTickers(val tickers: List<String>)

/** The manual price refresh as the server reports it (`state` is queued, running, completed, partial, failed, fresh...). */
@Serializable
data class QuoteJob(
    val state: String = "idle",
    val pending: List<String> = emptyList(),
    val message: String? = null,
    val requestedAt: String? = null,
) {
    val isPending: Boolean get() = state == "queued" || state == "running"

    /** Failure-toned: partial, failed or unavailable (or no job at all). */
    val isProblem: Boolean get() = state == "partial" || state == "failed" || state == "unavailable"
}

@Serializable
data class QuotesJobResponse(val job: QuoteJob? = null)

const val QUOTE_POLL_MS = 5_000L

/** The server fails a request after 20 minutes; the phone gives up a little later. */
const val QUOTE_POLL_LIMIT_MS = 21 * 60_000L

/**
 * Starts a price refresh and follows it until it settles (lib/quote-refresh-client.ts). Polling is read-only: stopping
 * it never cancels the server's work. A dropped poll is not a failed refresh, so it keeps waiting.
 */
suspend fun followQuoteJob(
    start: suspend () -> QuoteJob?,
    poll: suspend (since: String?) -> QuoteJob?,
    now: () -> Long = System::currentTimeMillis,
    sleep: suspend (Long) -> Unit = { delay(it) },
    onPending: (QuoteJob) -> Unit = {},
): QuoteJob? {
    val began = now()
    var job = start()
    while (job != null && job.isPending && now() - began < QUOTE_POLL_LIMIT_MS) {
        onPending(job)
        sleep(QUOTE_POLL_MS)
        job = runCatching { poll(job?.requestedAt) }.getOrElse { job }
    }
    return job
}
