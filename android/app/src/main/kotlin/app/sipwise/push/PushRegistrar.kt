package app.sipwise.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import app.sipwise.R
import app.sipwise.network.ApiClient
import app.sipwise.network.PushTestResponse
import app.sipwise.network.PushTokenRequest
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlin.coroutines.resume

const val DIVIDENDS_CHANNEL = "dividends"
private const val FCM_PREFIX = "fcm:"

/** Creates the notification channel the server names in every push (Android 8+). Safe to call repeatedly. */
fun ensureNotificationChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel =
        NotificationChannel(DIVIDENDS_CHANNEL, context.getString(R.string.push_channel_name), NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = context.getString(R.string.push_channel_description) }
    manager.createNotificationChannel(channel)
}

private suspend fun <T> Task<T>.await(): T? =
    suspendCancellableCoroutine { continuation ->
        addOnSuccessListener { continuation.resume(it) }
        addOnFailureListener { continuation.resume(null) }
        addOnCanceledListener { continuation.resume(null) }
    }

/**
 * Registers this phone's Firebase token with the server (as `fcm:<token>`). When the build has no google-services.json
 * (a local or fork build) Firebase never starts and [available] is false; nothing else in the app depends on push.
 */
class PushRegistrar(private val context: Context, private val api: ApiClient) {
    fun available(): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    suspend fun token(): String? = if (available()) FirebaseMessaging.getInstance().token.await() else null

    suspend fun register(token: String) {
        api.put("/api/mobile-push", PushTokenRequest(FCM_PREFIX + token), PushTokenRequest.serializer(), JsonElement.serializer())
    }

    suspend fun unregister() {
        api.delete("/api/mobile-push", JsonElement.serializer())
    }

    /** Sends a test notification to this account's registered phones; returns how many were sent. */
    suspend fun test(): Int = api.post<Unit, PushTestResponse>("/api/mobile-push/test", null, Unit.serializer(), PushTestResponse.serializer()).sent
}
