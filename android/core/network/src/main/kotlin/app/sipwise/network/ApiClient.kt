package app.sipwise.network

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val REQUEST_TIMEOUT_SECONDS = 30L
private const val STATUS_UNAUTHORIZED = 401
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

/** A failed API call: the server's own message and machine-readable code, or a platform message. */
class ApiRequestException(
    message: String,
    val status: Int,
    val code: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

val ApiJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
    }

fun interface TokenSource {
    suspend fun token(): String?
}

/**
 * Talks to the Sipwise Worker. Same behaviour as the React Native client (mobile/src/api/client.ts): bearer token,
 * 30 second timeout, `{ error, code }` JSON errors, Cloudflare error pages mapped to friendly messages, and a callback
 * when the server rejects the token.
 */
class ApiClient(
    baseUrl: String,
    private val tokens: TokenSource,
    private val onUnauthorized: () -> Unit = {},
    http: OkHttpClient = OkHttpClient(),
) {
    private val base = baseUrl.trimEnd('/')
    private val http =
        http.newBuilder()
            .callTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()

    suspend fun <T> get(
        path: String,
        serializer: KSerializer<T>,
    ): T = request("GET", path, null, serializer)

    suspend fun <B, T> post(
        path: String,
        body: B?,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
        authed: Boolean = true,
    ): T = request("POST", path, body?.let { ApiJson.encodeToString(bodySerializer, it) }, serializer, authed)

    suspend fun <B, T> put(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
    ): T = request("PUT", path, ApiJson.encodeToString(bodySerializer, body), serializer)

    suspend fun <T> delete(
        path: String,
        serializer: KSerializer<T>,
    ): T = request("DELETE", path, null, serializer)

    suspend fun <B, T> delete(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
    ): T = request("DELETE", path, ApiJson.encodeToString(bodySerializer, body), serializer)

    private suspend fun <T> request(
        method: String,
        path: String,
        json: String?,
        serializer: KSerializer<T>,
        authed: Boolean = true,
    ): T {
        val builder = Request.Builder().url("$base$path".toHttpUrl()).header("Accept", "application/json")
        val payload: RequestBody? = json?.toRequestBody(JSON_MEDIA)
        builder.method(method, payload ?: if (method == "GET") null else ByteArray(0).toRequestBody(null))
        if (authed) tokens.token()?.let { builder.header("Authorization", "Bearer $it") }
        val (status, text) = execute(builder.build())
        return parse(status, text, serializer, authed)
    }

    private suspend fun execute(request: Request): Pair<Int, String> =
        try {
            http.newCall(request).await().use { it.code to (it.body?.string().orEmpty()) }
        } catch (e: IOException) {
            throw ApiRequestException("Could not reach Sipwise. Check your connection.", 0, cause = e)
        }

    private fun <T> parse(
        status: Int,
        text: String,
        serializer: KSerializer<T>,
        authed: Boolean,
    ): T {
        val element = runCatching { ApiJson.parseToJsonElement(text) }.getOrNull()
        if (status in 200..299) {
            return try {
                ApiJson.decodeFromString(serializer, text)
            } catch (e: IllegalArgumentException) {
                throw ApiRequestException("Unexpected response from Sipwise.", status, cause = e)
            }
        }
        if (status == STATUS_UNAUTHORIZED && authed) onUnauthorized()
        val platform = if (element == null) classifyPlatformResponse(status, text) else null
        if (platform != null) throw ApiRequestException(platform.message, status, platform.wire)
        val obj = element as? JsonObject
        val message = obj?.get("error")?.jsonPrimitive?.contentOrNull ?: "Request failed ($status)."
        throw ApiRequestException(message, status, obj?.get("code")?.jsonPrimitive?.contentOrNull)
    }
}

private suspend fun Call.await(): Response =
    suspendCancellableCoroutine { cont ->
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) {
                    if (!cont.isCancelled) cont.resumeWithException(e)
                }

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    cont.resume(response)
                }
            },
        )
        cont.invokeOnCancellation { cancel() }
    }
