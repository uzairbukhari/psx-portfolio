package app.sipwise.network

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class QuoteJobTest {
    private fun job(state: String) = QuoteJob(state = state, requestedAt = "t0")

    @Test
    fun `polls until the job settles and passes the request time back`() =
        runBlocking {
            val answers = ArrayDeque(listOf(job("running"), job("completed")))
            val since = mutableListOf<String?>()
            val result =
                followQuoteJob(
                    start = { job("queued") },
                    poll = {
                        since.add(it)
                        answers.removeFirst()
                    },
                    sleep = {},
                )
            assertEquals("completed", result?.state)
            assertEquals(listOf<String?>("t0", "t0"), since)
        }

    @Test
    fun `a dropped poll keeps waiting instead of failing`() =
        runBlocking {
            var calls = 0
            val result =
                followQuoteJob(
                    start = { job("queued") },
                    poll = { if (calls++ == 0) error("offline") else job("completed") },
                    sleep = {},
                )
            assertEquals("completed", result?.state)
        }

    @Test
    fun `gives up after the poll limit`() =
        runBlocking {
            var clock = 0L
            val result = followQuoteJob(start = { job("running") }, poll = { job("running") }, now = { clock }, sleep = { clock += QUOTE_POLL_LIMIT_MS })
            assertTrue(result?.isPending == true)
        }
}
