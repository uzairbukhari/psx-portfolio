package app.sipwise.session

import app.sipwise.network.ApiJson
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The shared TypeScript (`lib/`), reached through a JavaScript sandbox on the phone. Text in, text out. */
interface EngineBridge {
    /** Calls the engine function [name] with [argsJson] and returns its raw JSON reply. */
    suspend fun call(
        name: String,
        argsJson: String,
    ): String

    /** Drops the isolate and everything decrypted inside it. */
    fun close()
}

open class EngineException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/** The sandbox process or isolate is gone (Android reclaims it while the app is in the background); the vault must be opened again. */
class EngineDiedException(
    message: String,
    cause: Throwable? = null,
) : EngineException(message, cause)

/** Where failures the app survives are noted so they can be read later (More > Crash report). Set once by the app. */
object EngineFailures {
    @Volatile var sink: (where: String, error: Throwable) -> Unit = { _, _ -> }

    fun report(
        where: String,
        error: Throwable,
    ) {
        runCatching { sink(where, error) }
    }
}

/**
 * Reads an engine reply into [serializer]'s type. A reply the screen cannot read becomes an [EngineException] (the
 * screens already handle those) instead of an uncaught decoding error that would close the app.
 */
fun <T> decodeView(
    serializer: DeserializationStrategy<T>,
    element: JsonElement,
): T =
    try {
        ApiJson.decodeFromJsonElement(serializer, element)
    } catch (e: IllegalArgumentException) {
        val name = serializer.descriptor.serialName.substringAfterLast('.')
        EngineFailures.report("decode:$name", e)
        throw EngineException("This screen could not read its data ($name). Please report it from More.", e)
    }

/** Typed access to the engine's `{ ok, value | error }` replies (android/engine/src/handlers.ts). */
class EngineClient(
    private val bridge: EngineBridge,
    private val onDied: () -> Unit = {},
) {
    suspend fun call(
        name: String,
        args: Map<String, String> = emptyMap(),
    ): JsonElement {
        val argsJson = JsonObject(args.mapValues { JsonPrimitive(it.value) }).toString()
        val raw =
            try {
                bridge.call(name, argsJson)
            } catch (e: EngineDiedException) {
                EngineFailures.report("engine-died:$name", e)
                onDied()
                throw e
            } catch (e: EngineException) {
                EngineFailures.report("engine:$name", e)
                throw e
            }
        val reply = ApiJson.parseToJsonElement(raw).jsonObject
        if (reply["ok"]?.jsonPrimitive?.booleanOrNull != true) {
            throw EngineException(reply["error"]?.jsonPrimitive?.contentOrNull ?: "The calculation engine failed.")
        }
        return reply["value"] ?: JsonPrimitive(null as String?)
    }

    fun close() = bridge.close()
}

/** The vault's account rules, answered by the shared TypeScript so the Android app can never disagree with the web. */
class EngineAccountRules(private val engine: EngineClient) : AccountRules {
    override suspend fun blank(): String = engine.call("account.blank").toString()

    override suspend fun normalize(accountJson: String): String =
        try {
            engine.call("account.normalize", mapOf("json" to accountJson)).toString()
        } catch (e: EngineException) {
            throw IllegalArgumentException(e.message, e)
        }

    override suspend fun assertWritable(
        currentJson: String,
        nextJson: String,
    ) {
        try {
            engine.call("account.assertWritable", mapOf("current" to currentJson, "next" to nextJson))
        } catch (e: EngineException) {
            throw IllegalStateException(e.message, e)
        }
    }
}
