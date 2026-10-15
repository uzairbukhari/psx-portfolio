package app.sipwise.analytics

import app.sipwise.BuildConfig
import app.sipwise.data.Preferences
import app.sipwise.network.AnalyticsEvent
import app.sipwise.network.AnalyticsQueue
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiRequestException
import app.sipwise.network.Events
import app.sipwise.network.EventsBatch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * First-party usage analytics (docs: plans/analytics.md). Catalog events only: screen and feature names with closed
 * values, never a ticker, amount or note. Sent in batches to /api/events with the app token, and switched off by the
 * per-device switch in More. A failed send is dropped; analytics must never get in the way.
 */
class Analytics(
    private val api: ApiClient,
    private val preferences: Preferences,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = AnalyticsQueue()
    private val sessionId = UUID.randomUUID().toString()
    private var stateReported = false

    @Volatile private var signedIn = false

    /** Events only flow while someone is signed in; signing out drops anything still waiting. */
    fun setSignedIn(value: Boolean) {
        signedIn = value
        if (!value) {
            queue.clear()
            stateReported = false
        }
    }

    fun track(
        event: String,
        vararg props: Pair<String, String>,
    ) {
        if (!signedIn || !preferences.analyticsEnabled.value) return
        val flush = synchronized(queue) { queue.add(AnalyticsEvent(event, props.toMap())) }
        if (flush) flush()
    }

    /** Tells the server whether this account already had a vault, once per session whatever the sharing switch says. */
    fun reportAccountState(vaultExists: Boolean) {
        if (!signedIn || stateReported) return
        stateReported = true
        val state = AnalyticsEvent(Events.ACCOUNT_STATE, mapOf("vault" to if (vaultExists) "exists" else "none"))
        scope.launch {
            try {
                send(listOf(state))
            } catch (ignored: ApiRequestException) {
                stateReported = false
            }
        }
    }

    fun setEnabled(value: Boolean) {
        preferences.setAnalyticsEnabled(value)
        if (!value) synchronized(queue) { queue.clear() }
    }

    fun flush() {
        val batch = synchronized(queue) { queue.take() }
        if (batch.isEmpty() || !signedIn) return
        scope.launch {
            try {
                send(batch)
            } catch (ignored: ApiRequestException) {
                // Dropped on purpose.
            }
        }
    }

    private suspend fun send(events: List<AnalyticsEvent>) {
        api.postNoContent("/api/events", EventsBatch(sessionId, PLATFORM, BuildConfig.VERSION_NAME, events), EventsBatch.serializer())
    }

    private companion object {
        const val PLATFORM = "android"
    }
}
