package app.sipwise.network

import kotlinx.serialization.Serializable

/** One usage event: a catalog name and closed-value props. Never a ticker, amount or name (lib/analytics-events.ts). */
@Serializable
data class AnalyticsEvent(val event: String, val props: Map<String, String> = emptyMap())

@Serializable
data class EventsBatch(
    val sessionId: String,
    val platform: String,
    val appVersion: String? = null,
    val events: List<AnalyticsEvent>,
)

/** The events the phone sends. The server drops anything outside its catalog, so this list mirrors the ones it knows. */
object Events {
    const val APP_OPENED = "app_opened"
    const val CLIENT_ERROR = "client_error"
    const val SCREEN_VIEWED = "screen_viewed"
    const val ENTRY_ADDED = "entry_added"
    const val ENTRY_EDITED = "entry_edited"
    const val ENTRY_DELETED = "entry_deleted"
    const val TARGETS_SAVED = "targets_saved"
    const val PICKS_STARTED = "picks_run_started"
    const val PICKS_COMPLETED = "picks_run_completed"
    const val PICKS_FAILED = "picks_run_failed"
    const val VAULT_CREATED = "vault_created"
    const val VAULT_UNLOCKED = "vault_unlocked"
    const val BACKUP_EXPORTED = "backup_exported"
    const val PORTFOLIO_CREATED = "portfolio_created"
    const val PORTFOLIO_SWITCHED = "portfolio_switched"
    const val SIGNED_OUT = "signed_out"
    const val ACCOUNT_STATE = "account_state"
}

/** Events waiting to be sent: flushed in batches of at most [BATCH] and dropped when sharing is switched off. */
class AnalyticsQueue {
    private val items = ArrayDeque<AnalyticsEvent>()

    val size: Int get() = items.size

    /** Adds an event and says whether enough have gathered to send now. */
    fun add(event: AnalyticsEvent): Boolean {
        items.addLast(event)
        while (items.size > MAX_QUEUED) items.removeFirst()
        return items.size >= FLUSH_AT
    }

    fun take(): List<AnalyticsEvent> {
        val out = ArrayList<AnalyticsEvent>(BATCH)
        while (out.size < BATCH && items.isNotEmpty()) out.add(items.removeFirst())
        return out
    }

    fun clear() = items.clear()

    companion object {
        const val BATCH = 50
        const val FLUSH_AT = 20
        const val MAX_QUEUED = 200
    }
}
