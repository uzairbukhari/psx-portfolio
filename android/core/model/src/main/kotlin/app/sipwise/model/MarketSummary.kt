package app.sipwise.model

import kotlinx.serialization.Serializable

@Serializable
data class MarketIndex(
    val name: String = "",
    val close: Double = 0.0,
    val change: Double = 0.0,
    val changePercent: Double = 0.0,
)

@Serializable
data class IndexFreshness(val freshness: String = "")

@Serializable
data class OtherIndex(
    val code: String,
    val label: String,
    val close: Double = 0.0,
    val changePercent: Double = 0.0,
    val asOf: String = "",
    val meta: IndexFreshness = IndexFreshness(),
)

@Serializable
data class MarketBreadth(
    val advances: Int = 0,
    val declines: Int = 0,
    val unchanged: Int = 0,
    val covered: Int = 0,
    val source: String = "",
)

@Serializable
data class IndexPointRow(val time: Double, val value: Double)

@Serializable
data class MarketStateRow(val label: String = "", val estimated: Boolean = false)

/**
 * One company's day quote from the shared market cache, asked for with `?tickers=`. Public data: the server is told
 * only which symbols to price, never how many are held.
 */
@Serializable
data class CompanyQuoteRow(
    val ticker: String,
    val name: String = "",
    val price: Double? = null,
    val change: Double? = null,
    val changePercent: Double? = null,
    val volume: Double? = null,
    val high: Double? = null,
    val low: Double? = null,
    val previousClose: Double? = null,
)

@Serializable
data class MarketSummaryBody(
    val index: MarketIndex? = null,
    val indices: List<OtherIndex> = emptyList(),
    val breadth: MarketBreadth? = null,
    val series: List<IndexPointRow> = emptyList(),
    val market: MarketStateRow = MarketStateRow(),
    val companies: List<CompanyQuoteRow> = emptyList(),
)

/** GET /api/market-summary: the KSE-100 snapshot from the shared market cache (public data, no holdings). */
@Serializable
data class MarketSummaryResponse(
    val summary: MarketSummaryBody? = null,
    val fetchedAt: String? = null,
)
