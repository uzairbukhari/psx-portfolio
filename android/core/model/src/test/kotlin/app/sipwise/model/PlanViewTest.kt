package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PlanViewTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the engine plan reply`() {
        val view = json.decodeFromString(PlanView.serializer(), checkNotNull(javaClass.getResource("/plan-view.json")).readText())
        assertEquals("2026-10", view.month)
        assertNotNull(view.plan)
        assertEquals(view.targetedCount > 0, view.plan!!.rows.isNotEmpty())
    }

    @Test
    fun `shifts months across years`() {
        assertEquals("2027-01", shiftMonth("2026-12", 1))
        assertEquals("2025-12", shiftMonth("2026-01", -1))
        assertEquals("2026-10", shiftMonth("2026-10", 0))
    }

    @Test
    fun `price problems are separated`() {
        val view =
            PlanView(
                now = "2026-10", month = "2026-10", homeId = "p", readOnly = false, companyCount = 1, targetedCount = 1,
                targetState = TargetState(100.0, 0.0, "exact"), budgetSet = true,
                planErrors = listOf("Missing prices: AAA", "Something else"),
            )
        assertEquals(listOf("Missing prices: AAA"), view.priceErrors)
        assertEquals(listOf("Something else"), view.otherErrors)
    }
}
