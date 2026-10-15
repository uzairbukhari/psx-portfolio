package app.sipwise.model

import kotlinx.serialization.Serializable

/** One company's suggested buy (or the reason there is none). Produced by the shared `plan()`. */
@Serializable
data class PlanRow(
    val ticker: String,
    val name: String,
    val price: Double? = null,
    val currentWeight: Double = 0.0,
    val target: Double = 0.0,
    val shares: Double = 0.0,
    val amount: Double = 0.0,
    val reason: String = "",
)

@Serializable
data class SipPlan(
    val budget: Double,
    val already: Double,
    val remaining: Double,
    val invested: Double,
    val leftover: Double,
    val errors: List<String> = emptyList(),
    val rows: List<PlanRow> = emptyList(),
)

@Serializable
data class MonthBuy(
    val id: String,
    val date: String,
    val ticker: String,
    val shares: Double,
    val price: Double? = null,
    val amount: Double,
)

@Serializable
data class TargetState(val total: Double, val remaining: Double, val status: String)

@Serializable
data class Receiver(val id: String, val name: String)

/** The Plan tab in targets mode, for one month. */
@Serializable
data class PlanView(
    val now: String,
    val month: String,
    val homeId: String,
    val readOnly: Boolean,
    val receivers: List<Receiver> = emptyList(),
    val companyCount: Int,
    val targetedCount: Int,
    val targetState: TargetState,
    val budgetSet: Boolean,
    val budget: Double? = null,
    val error: String? = null,
    val planErrors: List<String> = emptyList(),
    val plan: SipPlan? = null,
    val buys: List<PlanRow> = emptyList(),
    val bought: List<MonthBuy> = emptyList(),
) {
    /** Price problems get their own notice with a refresh action; the rest are shown as they come. */
    val priceErrors: List<String> get() = planErrors.filter { PRICE_PROBLEM.containsMatchIn(it) }
    val otherErrors: List<String> get() = planErrors.filterNot { PRICE_PROBLEM.containsMatchIn(it) }
    val complete: Boolean get() = plan != null && budgetSet && plan.errors.isEmpty() && plan.remaining == 0.0
}

private val PRICE_PROBLEM = Regex("^(Missing prices|Older quotes)")

/** A row in the review sheet: the typed text, as the shared parser wants it. */
@Serializable
data class ReviewRow(val ticker: String, val name: String, val shares: String, val price: String)

@Serializable
data class ReviewResult(
    val errors: Map<String, String> = emptyMap(),
    val gross: Double = 0.0,
    val fees: Double = 0.0,
    val total: Double = 0.0,
)

/** "2026-10" moved by [delta] months. */
fun shiftMonth(
    month: String,
    delta: Int,
): String {
    val (y, m) = month.split("-").map { it.toInt() }
    val index = y * MONTHS_PER_YEAR + (m - 1) + delta
    return "%d-%02d".format(index / MONTHS_PER_YEAR, index % MONTHS_PER_YEAR + 1)
}

private const val MONTHS_PER_YEAR = 12
