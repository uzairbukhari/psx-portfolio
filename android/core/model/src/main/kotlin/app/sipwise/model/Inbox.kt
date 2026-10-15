package app.sipwise.model

import kotlinx.serialization.Serializable

/** The four lists the Inbox can show. [key] is what the shared TypeScript calls them. */
enum class InboxFilter(val key: String) { INBOX("inbox"), UNREAD("unread"), CLEARED("cleared"), ALL("all") }

@Serializable
data class InboxCounts(val inbox: Int = 0, val unread: Int = 0, val cleared: Int = 0, val all: Int = 0) {
    fun of(filter: InboxFilter): Int =
        when (filter) {
            InboxFilter.INBOX -> inbox
            InboxFilter.UNREAD -> unread
            InboxFilter.CLEARED -> cleared
            InboxFilter.ALL -> all
        }
}

@Serializable
data class InboxItem(
    val id: String,
    val at: String,
    val ticker: String? = null,
    val title: String,
    val from: String? = null,
    val body: String = "",
    val read: Boolean = false,
    val cleared: Boolean = false,
    val unread: Boolean = false,
    val canOpen: Boolean = false,
    val expected: Boolean = false,
)

@Serializable
data class InboxView(val counts: InboxCounts = InboxCounts(), val items: List<InboxItem> = emptyList())
