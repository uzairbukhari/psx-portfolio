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

class InsightsTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun resource(name: String) = checkNotNull(javaClass.getResource("/$name")).readText()

    @Test
    fun `decodes the insights reply`() {
        val view = json.decodeFromString(InsightsView.serializer(), resource("insights-view.json"))
        assertTrue(view.companyAllocation.isNotEmpty())
        assertTrue(view.summary.pricedValue > 0)
    }

    @Test
    fun `decodes the track record reply`() {
        val view = json.decodeFromString(TrackView.serializer(), resource("track-view.json"))
        assertTrue(view.value.kind == "empty" || view.value.isChart)
        assertEquals(false, view.benchmark.isChart)
    }
}

class MarketSummaryTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the market summary and tolerates extra fields`() {
        val text =
            """{"summary":{"index":{"name":"KSE100","close":120000.5,"change":-10.25,"changePercent":-0.01,"x":1},
            |"indices":[{"code":"KMI30","label":"KMI 30","close":1.5,"changePercent":0.2,"asOf":"x","meta":{"freshness":"fresh","reason":"r"}}],
            |"breadth":{"advances":5,"declines":3,"unchanged":1,"covered":9,"source":"All Share"},
            |"series":[{"time":1.0,"value":2.0}],"market":{"label":"Open","estimated":false,"isOpen":true}},"fetchedAt":"2026-10-15T10:00:00Z"}
            """.trimMargin()
        val response = json.decodeFromString(MarketSummaryResponse.serializer(), text)
        assertEquals(120000.5, response.summary?.index?.close)
        assertEquals("fresh", response.summary?.indices?.first()?.meta?.freshness)
        assertEquals(9, response.summary?.breadth?.covered)
    }

    @Test
    fun `an empty reply decodes to no summary`() {
        assertTrue(json.decodeFromString(MarketSummaryResponse.serializer(), "{}").summary == null)
    }
}
