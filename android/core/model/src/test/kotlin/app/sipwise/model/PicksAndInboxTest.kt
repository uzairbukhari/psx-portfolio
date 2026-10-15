package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PicksTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the engine picks reply`() {
        val text = checkNotNull(javaClass.getResource("/picks-view.json")).readText()
        val view = json.decodeFromString(PicksView.serializer(), text)
        assertEquals(15, view.max)
        assertTrue(view.companies.size >= 2)
        assertTrue(view.shortlist.size <= view.max)
    }

    @Test
    fun `decodes a finished run with its picks`() {
        val text =
            """{"portfolioId":"a","month":"2026-10","max":15,"run":{"status":"completed","amount":1000.0,"marketOutlook":"Calm"},
            |"picks":[{"ticker":"AAA","name":"A","allocationPct":50,"allocationPkr":500,"confidence":"High","price":10,"shares":40,"estimatedSpend":400},
            |{"ticker":"BBB","name":"B","allocationPct":50,"allocationPkr":500,"confidence":"Low"}]}
            """.trimMargin()
        val view = json.decodeFromString(PicksView.serializer(), text)
        assertTrue(view.run?.completed == true)
        assertTrue(view.picks[0].recordable)
        assertFalse(view.picks[1].recordable)
    }

    @Test
    fun `progress moves only with real counts`() {
        assertEquals(10, PicksProgress(PicksStep.GATHERING, completed = 0, total = 4).percent)
        assertEquals(30, PicksProgress(PicksStep.GATHERING, completed = 2, total = 4).percent)
        assertEquals(50, PicksProgress(PicksStep.GATHERING, completed = 9, total = 4).percent)
        assertEquals(85, PicksProgress(PicksStep.ALLOCATING).percent)
        assertEquals(100, PicksProgress(PicksStep.SAVED).percent)
    }
}

class InboxTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the engine inbox reply`() {
        val text = checkNotNull(javaClass.getResource("/inbox-view.json")).readText()
        val view = json.decodeFromString(InboxView.serializer(), text)
        assertEquals(view.counts.all, view.items.size)
        assertEquals(view.counts.of(InboxFilter.UNREAD), view.counts.unread)
    }
}
