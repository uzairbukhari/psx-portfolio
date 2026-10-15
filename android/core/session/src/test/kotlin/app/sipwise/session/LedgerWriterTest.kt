package app.sipwise.session

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

private class FakeBridge(private val mutateReply: String) : EngineBridge {
    val calls = mutableListOf<Pair<String, String>>()

    override suspend fun call(
        name: String,
        argsJson: String,
    ): String {
        calls += name to argsJson
        return if (name == "mutate" || name == "mutate.account") mutateReply else """{"ok":true,"value":{}}"""
    }

    override fun close() = Unit
}

private class FakeStore(override var account: String, override var revision: Int) : AccountStore {
    var failWith: Exception? = null
    val saves = mutableListOf<Pair<String, Int>>()

    var lastReplaceAll = false

    override suspend fun save(
        next: String,
        expectedRevision: Int,
        replaceAll: Boolean,
    ): Int {
        lastReplaceAll = replaceAll
        failWith?.let { throw it }
        saves += next to expectedRevision
        account = next
        revision = expectedRevision + 1
        return revision
    }
}

class LedgerWriterTest {
    private val params = buildJsonObject { put("ticker", "LUCK") }

    @Test
    fun savesTheNextAccountAndOnlyThenLoadsItIntoTheEngine() =
        runTest {
            val bridge = FakeBridge("""{"ok":true,"value":{"account":"NEXT"}}""")
            val store = FakeStore("OLD", 4)
            val change = LedgerWriter(store, EngineClient(bridge)).apply("p1", "trade", params)
            assertEquals(listOf("NEXT" to 4), store.saves)
            assertEquals(5, change.revision)
            assertEquals("OLD", change.previousAccount)
            assertEquals(listOf("mutate", "account.load"), bridge.calls.map { it.first })
            assertEquals("""{"json":"NEXT"}""", bridge.calls.last().second)
        }

    @Test
    fun aFailedSaveLeavesTheEngineUntouched() =
        runTest {
            val bridge = FakeBridge("""{"ok":true,"value":{"account":"NEXT"}}""")
            val store = FakeStore("OLD", 4).also { it.failWith = ConflictException() }
            assertFailsWith<ConflictException> { LedgerWriter(store, EngineClient(bridge)).apply("p1", "trade", params) }
            assertEquals(listOf("mutate"), bridge.calls.map { it.first })
        }

    @Test
    fun aRejectedChangeSavesNothing() =
        runTest {
            val bridge = FakeBridge("""{"ok":false,"error":"Enter the price per share."}""")
            val store = FakeStore("OLD", 4)
            val e = assertFailsWith<EngineException> { LedgerWriter(store, EngineClient(bridge)).apply("p1", "trade", params) }
            assertEquals("Enter the price per share.", e.message)
            assertEquals(emptyList(), store.saves)
        }

    @Test
    fun undoRestoresThePreviousAccountAtTheSavedRevision() =
        runTest {
            val bridge = FakeBridge("""{"ok":true,"value":{"account":"NEXT"}}""")
            val store = FakeStore("OLD", 4)
            val writer = LedgerWriter(store, EngineClient(bridge))
            val change = writer.apply("p1", "trade", params)
            writer.undo(change)
            assertEquals(listOf("NEXT" to 4, "OLD" to 5), store.saves)
            assertEquals("OLD", store.account)
        }

    @Test
    fun anAccountChangeIsSavedAsAnExplicitReplaceAndUndoneTheSameWay() =
        runTest {
            val bridge = FakeBridge("""{"ok":true,"value":{"account":"NEXT"}}""")
            val store = FakeStore("OLD", 4)
            val writer = LedgerWriter(store, EngineClient(bridge))
            val change = writer.applyAccount("tax", buildJsonObject { put("filerStatus", "filer") })
            assertEquals(true, store.lastReplaceAll)
            assertEquals(listOf("mutate.account", "account.load"), bridge.calls.map { it.first })
            store.lastReplaceAll = false
            writer.undo(change)
            assertEquals(true, store.lastReplaceAll)
            assertEquals("OLD", store.account)
        }
}
