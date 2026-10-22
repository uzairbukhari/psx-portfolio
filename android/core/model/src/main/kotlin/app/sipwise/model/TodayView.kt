package app.sipwise.model

import kotlinx.serialization.Serializable
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

/** The return breakdown behind "See total return". Null fields mean a price or cost is not known yet. */
@Serializable
data class ReturnBreakdown(
    val unrealised: Double? = null,
    val realised: Double,
    val dividendsReceived: Double,
    val totalBeforeTax: Double? = null,
    val afterTax: Double? = null,
    val expected: ExpectedDividends,
)

@Serializable
data class ExpectedDividends(val count: Int, val gross: Double)

@Serializable
data class MonthProgress(
    val month: String,
    val budgetSet: Boolean,
    val budget: Double,
    val bought: Double,
    val remaining: Double,
    val fraction: Double,
    val suggested: Int,
    val blockers: List<String> = emptyList(),
    val planError: String? = null,
)

/** Something that needs the person. The wording comes from the shared TypeScript so it matches the web and Expo apps. */
@Serializable
data class NextAction(
    val key: String,
    val title: String,
    val detail: String,
    val id: String? = null,
    val ticker: String? = null,
    val tickers: List<String> = emptyList(),
)

@Serializable
data class TodayView(
    val now: String,
    val month: String,
    val summary: PortfolioSummary,
    val openCount: Int,
    val error: String? = null,
    val firstUse: Boolean = false,
    val hasStocks: Boolean = true,
    val hasAssets: Boolean = false,
    val breakdown: ReturnBreakdown? = null,
    val progress: MonthProgress,
    val actions: List<NextAction> = emptyList(),
    val upcoming: List<UpcomingDividend> = emptyList(),
)

/** An expected payout: the company, its book-closure date and the amount the ledger calculated (null when it could not). */
@Serializable
data class UpcomingDividend(
    val ticker: String,
    val bookClosure: String,
    val amount: Double? = null,
    val paymentDate: String? = null,
)

@Serializable
data class Mover(val ticker: String, val change: Double, val percent: Double)

/** The last trading day's move over the holdings that have a price and a previous close. */
@Serializable
data class DayMove(
    val available: Boolean,
    val counted: Int = 0,
    val of: Int = 0,
    val amount: Double = 0.0,
    val percent: Double = 0.0,
    val gainer: Mover? = null,
    val loser: Mover? = null,
)

/** One portfolio's own day move, for the Portfolios card on Today. */
@Serializable
data class PortfolioMove(val id: String, val move: DayMove)

/** "October 2026" for a `YYYY-MM` month key, or "October" without the year. */
fun monthTitle(
    month: String,
    withYear: Boolean = true,
): String {
    val parsed = runCatching { YearMonth.parse(month) }.getOrNull() ?: return month
    val name = parsed.month.getDisplayName(TextStyle.FULL, Locale.ENGLISH)
    return if (withYear) "$name ${parsed.year}" else name
}

/** "Oct" for a `YYYY-MM` month key: the axis label of a by-month chart. */
fun monthShort(month: String): String {
    val parsed = runCatching { YearMonth.parse(month) }.getOrNull() ?: return month
    return parsed.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
}
