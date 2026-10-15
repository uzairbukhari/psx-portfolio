package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HoldingsViewTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesWhatTheSharedEngineReturns() {
        val text = checkNotNull(javaClass.getResource("/holdings-view.json")).readText()
        val view = json.decodeFromString(HoldingsView.serializer(), text)
        assertTrue(view.rows.isNotEmpty())
        assertEquals(view.rows.size, view.summary.heldCount)
        val first = view.rows.first()
        assertNotNull(first.value)
        assertEquals(view.summary.value, view.rows.sumOf { it.value ?: 0.0 }, 0.01)
        assertTrue(view.sectors.isNotEmpty())
    }
}
