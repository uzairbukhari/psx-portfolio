package app.sipwise.model

import kotlinx.serialization.Serializable

/** One ledger line. [editable] is false for imported or automatic entries. */
@Serializable
data class ActivityEntry(
    val id: String,
    val date: String,
    val kind: String,
    val ticker: String,
    val title: String,
    val detail: String,
    val amount: Double? = null,
    val editable: Boolean = false,
)

@Serializable
data class ActivitySection(val key: String, val title: String, val data: List<ActivityEntry>)

@Serializable
data class ActivityView(val count: Int, val sections: List<ActivitySection>)

enum class ActivityFilter(val wire: String) { ALL("all"), BUY("buy"), SELL("sell"), DIVIDEND("dividend"), SPLIT("split") }
