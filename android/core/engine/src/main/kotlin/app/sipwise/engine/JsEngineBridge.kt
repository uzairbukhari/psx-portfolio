package app.sipwise.engine

import android.content.Context
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import app.sipwise.session.EngineBridge
import kotlinx.coroutines.guava.await
import kotlinx.serialization.json.JsonPrimitive
import java.io.Closeable

private const val ENGINE_ASSET = "engine.js"
private const val MAX_HEAP_BYTES = 256L * 1024 * 1024

/** The sandbox this phone's WebView offers is missing or too old. */
class EngineUnavailableException(message: String) : Exception(message)

/**
 * Runs the shared TypeScript in one isolate of the Jetpack JavaScript sandbox. The isolate holds the decrypted account
 * between calls and is closed on lock, which discards everything inside it.
 */
class JsEngineBridge private constructor(
    private val sandbox: JavaScriptSandbox,
    private val isolate: JavaScriptIsolate,
) : EngineBridge, Closeable {
    override suspend fun call(
        name: String,
        argsJson: String,
    ): String {
        // A JSON string literal is a valid JavaScript string literal, so it escapes any text safely.
        val script = "sipwiseCall(${JsonPrimitive(name)}, ${JsonPrimitive(argsJson)})"
        return isolate.evaluateJavaScriptAsync(script).await()
    }

    override fun close() {
        isolate.close()
        sandbox.close()
    }

    companion object {
        suspend fun create(context: Context): JsEngineBridge {
            if (!JavaScriptSandbox.isSupported()) {
                throw EngineUnavailableException("This phone's WebView does not support the calculation engine. Update Android System WebView.")
            }
            val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext).await()
            val params = IsolateStartupParameters().apply { maxHeapSizeBytes = MAX_HEAP_BYTES }
            val isolate = sandbox.createIsolate(params)
            val source = context.applicationContext.assets.open(ENGINE_ASSET).bufferedReader().use { it.readText() }
            isolate.evaluateJavaScriptAsync(source).await()
            return JsEngineBridge(sandbox, isolate)
        }
    }
}
