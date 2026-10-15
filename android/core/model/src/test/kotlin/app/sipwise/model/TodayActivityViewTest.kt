package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TodayActivityViewTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun resource(name: String) = checkNotNull(javaClass.getResource(name)).readText()

    @Test
    fun decodesTheTodayViewTheEngineReturns() {
        val view = json.decodeFromString(TodayView.serializer(), resource("/today-view.json"))
        assertEquals("2026-10", view.month)
        assertNotNull(view.breakdown)
        assertTrue(view.progress.budgetSet)
        assertTrue(view.actions.any { it.key == "dividend" && it.id != null })
    }

    @Test
    fun decodesTheActivityViewTheEngineReturns() {
        val view = json.decodeFromString(ActivityView.serializer(), resource("/activity-view.json"))
        assertEquals(view.count, view.sections.sumOf { it.data.size })
        assertTrue(view.sections.first().title.matches(Regex("""[A-Z][a-z]+ \d{4}""")))
    }

    @Test
    fun monthTitlesMatchTheExpoApp() {
        assertEquals("October 2026", monthTitle("2026-10"))
        assertEquals("March", monthTitle("2026-03", withYear = false))
        assertEquals("bad", monthTitle("bad"))
    }
}
