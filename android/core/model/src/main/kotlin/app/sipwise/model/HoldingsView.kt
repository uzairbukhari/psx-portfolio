package app.sipwise.model

import kotlinx.serialization.Serializable

/** One open (or sold-out) position as the Holdings screen shows it. Produced by the shared TypeScript. */
@Serializable
data class HoldingRow(
    val ticker: String,
    val name: String,
    val sector: String = "",
    val shares: Double,
    val average: Double? = null,
    val price: Double? = null,
    val priceDate: String? = null,
    val value: Double? = null,
    val cost: Double? = null,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val weight: Double? = null,
    val stale: Boolean = false,
    val expectedDividend: Boolean = false,
)

/** Headline numbers. Cost and gain are null when any price or cost is unknown, never guessed. */
@Serializable
data class PortfolioSummary(
    val heldCount: Int,
    val value: Double,
    val cost: Double? = null,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val missingPrice: List<String> = emptyList(),
    val unknownCost: List<String> = emptyList(),
    val incomplete: List<String> = emptyList(),
    val oldestQuoteDate: String? = null,
)

@Serializable
data class HoldingsView(
    val rows: List<HoldingRow>,
    val soldOut: List<HoldingRow> = emptyList(),
    val sectors: List<String> = emptyList(),
    val summary: PortfolioSummary,
    val error: String? = null,
)

enum class HoldingSort(val wire: String) { VALUE("value"), GAIN("gain"), WEIGHT("weight"), NAME("name") }
