package app.sipwise.model

import kotlinx.serialization.Serializable

/** One dividend on the company page: expected from a PSX announcement, or received. */
@Serializable
data class DividendRow(
    val id: String,
    val status: String,
    val date: String,
    val paymentDate: String? = null,
    val entitlementDate: String? = null,
    val perShare: Double? = null,
    val gross: Double,
    val tax: Double? = null,
    val taxIsActual: Boolean = false,
    val net: Double? = null,
    val source: String = "",
) {
    val expected: Boolean get() = status == "expected"
}

/** A portfolio that holds the company; prices and dividends are saved per portfolio. */
@Serializable
data class PortfolioRef(val id: String, val name: String, val locked: Boolean = false)

/** The company page. [found] is false when the ticker is not in the portfolio. */
@Serializable
data class CompanyView(
    val found: Boolean,
    val ticker: String = "",
    val name: String = "",
    val sector: String = "",
    val shares: Double = 0.0,
    val average: Double? = null,
    val cost: Double? = null,
    val value: Double? = null,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val realized: Double? = null,
    val price: Double? = null,
    val priceDate: String? = null,
    val priceManual: Boolean = false,
    val hiddenQuoteDate: String? = null,
    val portfolios: List<PortfolioRef> = emptyList(),
    val dividends: List<DividendRow> = emptyList(),
    val entries: List<ActivityEntry> = emptyList(),
)

/** Chart ranges, in the order the Expo app lists them. */
enum class HistoryRange(val wire: String) { DAY("today"), WEEK("7d"), MONTH("1m"), YEAR("1y"), YEARS3("3y"), YEARS5("5y") }

@Serializable
data class RangeChange(val change: Double, val percent: Double)

/** Price points are `[unix seconds, price]`. */
@Serializable
data class HistorySeries(val points: List<List<Double>> = emptyList(), val change: RangeChange? = null)

/** Entry ids are `portfolio::entry` when several portfolios are merged; a single portfolio uses the bare id. */
fun splitEntryId(
    id: String,
    fallbackPortfolio: String,
): Pair<String, String> {
    val at = id.indexOf("::")
    return if (at < 0) fallbackPortfolio to id else id.substring(0, at) to id.substring(at + 2)
}

/** The mutation kind the `void` op wants for an activity kind. */
fun voidKind(activityKind: String): String =
    when (activityKind) {
        "dividend" -> "dividend"
        "split" -> "split"
        else -> "trade"
    }

/** A portfolio in the chooser, with what it holds in words ("21 stocks · 1 plan"). */
@Serializable
data class ScopePortfolio(
    val id: String,
    val name: String,
    val locked: Boolean = false,
    val contents: String = "",
)

@Serializable
data class ScopeList(val portfolios: List<ScopePortfolio>)

/** The scope value that means every portfolio together. */
const val ALL_PORTFOLIOS = "all"

/** Account-wide settings (`settings.view`): the tax status is "filer", "non-filer" or empty when never chosen. */
@Serializable
data class SettingsView(val filerStatus: String = "")

/** What the public lookups need: every ticker, and the ones whose name or sector is still a placeholder. */
@Serializable
data class PublicWanted(val tickers: List<String> = emptyList(), val placeholders: List<String> = emptyList())

@Serializable
data class DividendSync(val changed: Boolean, val account: String? = null)

/** The readable (not encrypted) export, or why it cannot be shared (`backup.readable`). */
@Serializable
data class ReadableExport(
    val ok: Boolean,
    val text: String = "",
    val title: String = "",
    val reason: String? = null,
)
