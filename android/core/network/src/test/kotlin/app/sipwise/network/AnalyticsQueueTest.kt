package app.sipwise.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AnalyticsQueueTest {
    @Test
    fun `asks to flush once enough events gather and sends them in batches`() {
        val queue = AnalyticsQueue()
        repeat(AnalyticsQueue.FLUSH_AT - 1) { assertFalse(queue.add(AnalyticsEvent(Events.APP_OPENED))) }
        assertTrue(queue.add(AnalyticsEvent(Events.APP_OPENED)))
        repeat(40) { queue.add(AnalyticsEvent(Events.SCREEN_VIEWED, mapOf("screen" to "today"))) }
        assertEquals(AnalyticsQueue.BATCH, queue.take().size)
        assertEquals(10, queue.size)
    }

    @Test
    fun `never grows without bound and clears on opt out`() {
        val queue = AnalyticsQueue()
        repeat(AnalyticsQueue.MAX_QUEUED + 50) { queue.add(AnalyticsEvent(Events.APP_OPENED)) }
        assertEquals(AnalyticsQueue.MAX_QUEUED, queue.size)
        queue.clear()
        assertEquals(0, queue.size)
    }
}
