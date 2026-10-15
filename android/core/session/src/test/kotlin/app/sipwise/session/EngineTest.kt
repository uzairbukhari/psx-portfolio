package app.sipwise.session

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

private class ScriptedBridge(private val reply: String) : EngineBridge {
    var lastCall: Pair<String, String>? = null
    var closed = false

    override suspend fun call(
        name: String,
        argsJson: String,
    ): String {
        lastCall = name to argsJson
        return reply
    }

    override fun close() {
        closed = true
    }
}

class EngineTest {
    @Test
    fun successReplyReturnsTheValueAndEscapesArguments() =
        runTest {
            val bridge = ScriptedBridge("""{"ok":true,"value":{"portfolios":[]}}""")
            val rules = EngineAccountRules(EngineClient(bridge))
            assertEquals("""{"portfolios":[]}""", rules.normalize("""{"a":"quote\" and \\ slash"}"""))
            assertEquals("account.normalize", bridge.lastCall!!.first)
            assertEquals("""{"json":"{\"a\":\"quote\\\" and \\\\ slash\"}"}""", bridge.lastCall!!.second)
        }

    @Test
    fun failureReplyBecomesIllegalArgumentForNormalize() =
        runTest {
            val rules = EngineAccountRules(EngineClient(ScriptedBridge("""{"ok":false,"error":"Not an account."}""")))
            val e = assertFailsWith<IllegalArgumentException> { rules.normalize("x") }
            assertEquals("Not an account.", e.message)
        }

    @Test
    fun lockedPortfolioBecomesIllegalState() =
        runTest {
            val rules = EngineAccountRules(EngineClient(ScriptedBridge("""{"ok":false,"error":"Portfolio is locked."}""")))
            assertFailsWith<IllegalStateException> { rules.assertWritable("{}", "{}") }
        }

    @Test
    fun closeReachesTheBridge() {
        val bridge = ScriptedBridge("{}")
        EngineClient(bridge).close()
        assertEquals(true, bridge.closed)
    }
}
