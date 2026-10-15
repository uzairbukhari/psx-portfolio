package app.sipwise.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class EntryViewTest {
    @Test
    fun aBuyBecomesATradeWithEveryTypedField() {
        val form = EntryForm(EntryKind.BUY, "p1", "LUCK", "2026-10-01", shares = "10", price = "100", fees = "5", month = "2026-10", note = "n")
        val (op, params) = entryOperation(form)
        assertEquals("trade", op)
        assertEquals("buy", params["kind"]?.jsonPrimitive?.content)
        assertEquals("10", params["shares"]?.jsonPrimitive?.content)
        assertFalse("editingId" in params)
    }

    @Test
    fun dividendsAndSplitsUseTheirOwnFields() {
        val dividend = entryOperation(EntryForm(EntryKind.DIVIDEND, ticker = "MEBL", date = "2026-10-02", perShare = "4.5", editingId = "e1"))
        assertEquals("dividend", dividend.first)
        assertEquals("4.5", dividend.second["perShare"]?.jsonPrimitive?.content)
        assertEquals("e1", dividend.second["editingId"]?.jsonPrimitive?.content)
        assertFalse("shares" in dividend.second)
        val split = entryOperation(EntryForm(EntryKind.SPLIT, ticker = "MEBL", oldShares = "1", newShares = "2"))
        assertEquals("split", split.first)
        assertEquals("2", split.second["newShares"]?.jsonPrimitive?.content)
    }

    @Test
    fun decodesTheEntryOptionsTheEngineReturns() {
        val json = """{"today":"2026-10-15","month":"2026-10","portfolios":[{"id":"a","name":"Core","locked":false,"companies":[{"ticker":"LUCK","name":"Lucky","sector":"Cement"}]}]}"""
        val options = Json { ignoreUnknownKeys = true }.decodeFromString(EntryOptions.serializer(), json)
        assertEquals("LUCK", options.portfolios.single().companies.single().ticker)
    }
}
