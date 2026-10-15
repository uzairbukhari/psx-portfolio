package app.sipwise.session

import app.sipwise.network.ApiJson
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

class EngineException(message: String) : Exception(message)

/** Typed access to the engine's `{ ok, value | error }` replies (android/engine/src/handlers.ts). */
class EngineClient(private val bridge: EngineBridge) {
    suspend fun call(
        name: String,
        args: Map<String, String> = emptyMap(),
    ): JsonElement {
        val argsJson = JsonObject(args.mapValues { JsonPrimitive(it.value) }).toString()
        val reply = ApiJson.parseToJsonElement(bridge.call(name, argsJson)).jsonObject
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
