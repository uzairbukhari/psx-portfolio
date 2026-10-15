package app.sipwise.model

import kotlinx.serialization.Serializable

/** One company's row in the targets editor: the typed weight and the screening fields. */
@Serializable
data class TargetDraft(
    val ticker: String,
    val weight: String,
    val approved: Boolean,
    val screenDate: String,
)

@Serializable
data class TargetsView(
    val homeId: String,
    val locked: Boolean,
    val today: String,
    val cap: Int,
    val rows: List<TargetDraft>,
    val companies: List<EntryCompany>,
)

@Serializable
data class TargetTotals(
    val total: Double,
    val remaining: Double,
    val status: String,
    val overCap: List<String> = emptyList(),
)

@Serializable
data class ScreenStatus(val state: String, val label: String)

@Serializable
data class TargetsEval(val totals: TargetTotals, val statuses: Map<String, ScreenStatus> = emptyMap())

@Serializable
data class CompanySearch(val total: Int, val items: List<EntryCompany>)

/** A weight text moved by [delta] percentage points, kept between 0 and 100 (the Expo stepper). */
fun bumpWeight(
    text: String,
    delta: Int,
): String {
    val current = text.replace(",", "").trim().toDoubleOrNull() ?: 0.0
    val next = (Math.round((current + delta) * PERCENT_SCALE) / PERCENT_SCALE).coerceIn(0.0, MAX_PERCENT)
    return if (next == Math.floor(next)) next.toLong().toString() else next.toString()
}

private const val PERCENT_SCALE = 100.0
private const val MAX_PERCENT = 100.0
