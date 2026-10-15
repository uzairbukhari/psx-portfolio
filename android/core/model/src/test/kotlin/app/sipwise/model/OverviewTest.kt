package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OverviewTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun resource(name: String) = checkNotNull(javaClass.getResource("/$name")).readText()

    @Test
    fun `decodes the engine overview reply`() {
        val overview = json.decodeFromString(AccountOverview.serializer(), resource("overview.json"))
        assertTrue(overview.total.value > 0)
        assertTrue(overview.classes.isNotEmpty())
        assertTrue(overview.portfolios.size >= 2)
        assertEquals(overview.classes.sumOf { it.value }.toInt(), overview.total.value.toInt())
        assertTrue(overview.income.taxYear.isNotEmpty())
    }

    @Test
    fun `decodes the engine assets reply`() {
        val assets = json.decodeFromString(AssetsView.serializer(), resource("assets.json"))
        assertTrue(!assets.isEmpty)
        assertTrue(assets.metals.all { it.name.isNotEmpty() })
    }

    @Test
    fun `an overview without data decodes to defaults`() {
        val overview = json.decodeFromString(AccountOverview.serializer(), "{}")
        assertEquals(0.0, overview.total.value)
        assertTrue(overview.classes.isEmpty())
    }
}
