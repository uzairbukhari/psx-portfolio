package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CompanyViewTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the engine company reply`() {
        val text = checkNotNull(javaClass.getResource("/company-view.json")).readText()
        val view = json.decodeFromString(CompanyView.serializer(), text)
        assertTrue(view.found)
        assertTrue(view.shares > 0)
        assertTrue(view.entries.isNotEmpty())
        assertEquals(view.ticker, view.entries.first().ticker)
    }

    @Test
    fun `decodes a missing company`() {
        val view = json.decodeFromString(CompanyView.serializer(), """{"found":false,"error":null}""")
        assertEquals(false, view.found)
    }

    @Test
    fun `decodes a history series`() {
        val s = json.decodeFromString(HistorySeries.serializer(), """{"points":[[1.0,2.0],[3.0,4.0]],"change":{"change":2.0,"percent":100.0}}""")
        assertEquals(2, s.points.size)
        assertEquals(100.0, s.change?.percent)
    }

    @Test
    fun `splits entry ids`() {
        assertEquals("p1" to "t-3", splitEntryId("p1::t-3", "x"))
        assertEquals("x" to "t-3", splitEntryId("t-3", "x"))
        assertEquals("dividend", voidKind("dividend"))
        assertEquals("trade", voidKind("opening"))
    }
}
