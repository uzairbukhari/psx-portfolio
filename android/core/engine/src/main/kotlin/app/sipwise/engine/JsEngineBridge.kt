package app.sipwise.engine

import android.content.Context
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.IsolateTerminatedException
import androidx.javascriptengine.JavaScriptException
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import app.sipwise.session.EngineBridge
import app.sipwise.session.EngineDiedException
import app.sipwise.session.EngineException
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
        return try {
            isolate.evaluateJavaScriptAsync(script).await()
        } catch (e: IsolateTerminatedException) {
            throw EngineDiedException("The calculation engine stopped while the app was in the background. Unlock again to continue.")
        } catch (e: JavaScriptException) {
            throw EngineException(e.message ?: "The calculation engine failed.")
        } catch (e: IllegalStateException) {
            // The isolate was closed by a lock while this call was waiting.
            throw EngineDiedException("The vault was locked. Unlock again to continue.")
        }
    }

    override fun close() {
        runCatching { isolate.close() }
        runCatching { sandbox.close() }
    }

    companion object {
        suspend fun create(context: Context): JsEngineBridge {
            if (!JavaScriptSandbox.isSupported()) {
                throw EngineUnavailableException("This phone's WebView does not support the calculation engine. Update Android System WebView.")
            }
            val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext).await()
            val params =
                IsolateStartupParameters().apply {
                    if (sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
                        maxHeapSizeBytes = MAX_HEAP_BYTES
                    }
                }
            val isolate = sandbox.createIsolate(params)
            val source = context.applicationContext.assets.open(ENGINE_ASSET).bufferedReader().use { it.readText() }
            isolate.evaluateJavaScriptAsync(source).await()
            return JsEngineBridge(sandbox, isolate)
        }
    }
}
