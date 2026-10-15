package app.sipwise.model

import kotlinx.serialization.Serializable

@Serializable
data class LabelWeight(val label: String, val weight: Double)

@Serializable
data class TargetWeight(val ticker: String, val actual: Double, val target: Double)

@Serializable
data class GainRow(val ticker: String, val gain: Double, val gainPercent: Double? = null)

@Serializable
data class MonthInvested(val month: String, val invested: Double)

@Serializable
data class NamedWeight(val name: String, val weight: Double)

@Serializable
data class InsightsSummary(
    val pricedValue: Double = 0.0,
    val totalGain: Double? = null,
    val totalGainPercent: Double? = null,
    val grandTotalReturn: Double? = null,
    val quotesPriced: Int = 0,
    val quotesHeld: Int = 0,
    val topThreeWeight: Double? = null,
    val largestSector: NamedWeight? = null,
)

@Serializable
data class RealizedSummary(
    val totalRealizedGain: Double = 0.0,
    val dividendsGross: Double = 0.0,
    val capitalGainsTax: Double? = null,
    val taxProfileSet: Boolean = false,
)

/** The Insights report sections for the chosen scope. */
@Serializable
data class InsightsView(
    val summary: InsightsSummary = InsightsSummary(),
    val companyAllocation: List<LabelWeight> = emptyList(),
    val sectorAllocation: List<LabelWeight> = emptyList(),
    val targets: List<TargetWeight> = emptyList(),
    val performance: List<GainRow> = emptyList(),
    val monthly: List<MonthInvested> = emptyList(),
    val realized: RealizedSummary = RealizedSummary(),
)

@Serializable
data class TrackBatches(val empty: Boolean = true, val batches: List<List<String>> = emptyList())

/** Value against money put in. [kind] is `chart` or `empty`. */
@Serializable
data class ValueChart(
    val kind: String,
    val reason: String = "",
    val value: List<List<Double>> = emptyList(),
    val moneyIn: List<List<Double>> = emptyList(),
    val summary: String = "",
    val spoken: String = "",
    val notes: List<String> = emptyList(),
) {
    val isChart: Boolean get() = kind == "chart"
}

@Serializable
data class ReturnText(val headline: String? = null, val spoken: String? = null, val note: String? = null)

/** The KSE-100 comparison. [kind] is `chart` or `unavailable`. */
@Serializable
data class BenchmarkChart(
    val kind: String,
    val reason: String = "",
    val portfolio: List<List<Double>> = emptyList(),
    val benchmark: List<List<Double>> = emptyList(),
    val summary: String = "",
    val spoken: String = "",
    val yours: ReturnText = ReturnText(),
    val index: ReturnText = ReturnText(),
    val notes: List<String> = emptyList(),
    val legend: String = "",
) {
    val isChart: Boolean get() = kind == "chart"
}

@Serializable
data class TrackView(val value: ValueChart, val mwr: ReturnText = ReturnText(), val benchmark: BenchmarkChart)

/** Chart ranges for the track record. [key] is what the shared TypeScript calls them. */
enum class TrackRange(val key: String) { MONTH("1m"), HALF("6m"), YEAR("1y"), ALL("all") }
