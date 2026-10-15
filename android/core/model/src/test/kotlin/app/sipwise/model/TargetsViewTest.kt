package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class TargetsViewTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `steps a weight within 0 and 100`() {
        assertEquals("16", bumpWeight("15", 1))
        assertEquals("0", bumpWeight("0", -1))
        assertEquals("100", bumpWeight("100", 1))
        assertEquals("1", bumpWeight("", 1))
        assertEquals("15.5", bumpWeight("14.5", 1))
    }

    @Test
    fun `decodes an evaluation`() {
        val text = """{"totals":{"total":92,"remaining":8,"status":"under","overCap":[]},"statuses":{"A":{"state":"valid","label":"ok"}}}"""
        val eval = json.decodeFromString(TargetsEval.serializer(), text)
        assertEquals("under", eval.totals.status)
        assertEquals("ok", eval.statuses.getValue("A").label)
    }
}
