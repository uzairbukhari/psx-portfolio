package app.sipwise.model

import kotlinx.serialization.Serializable

@Serializable
data class PicksCounts(val saved: Int = 0, val held: Int = 0, val shortlisted: Int = 0)

@Serializable
data class PickCompany(val ticker: String, val name: String)

@Serializable
data class PickEvidence(val label: String, val value: Double)

@Serializable
data class PickSource(val url: String, val title: String, val date: String = "")

/** One suggested company in the newest run, with the share estimate from the latest saved price. */
@Serializable
data class PickRow(
    val ticker: String,
    val name: String,
    val allocationPct: Double,
    val allocationPkr: Double,
    val confidence: String,
    val thesis: String = "",
    val risks: List<String> = emptyList(),
    val evidence: List<PickEvidence> = emptyList(),
    val sources: List<PickSource> = emptyList(),
    val price: Double? = null,
    val shares: Double? = null,
    val estimatedSpend: Double? = null,
) {
    /** Whether this row can be recorded as a buy. */
    val recordable: Boolean get() = price != null && (shares ?: 0.0) > 0
}

@Serializable
data class PicksRun(
    val status: String,
    val error: String? = null,
    val amount: Double = 0.0,
    val feePct: Double = 0.0,
    val dataAsOf: String? = null,
    val marketOutlook: String = "",
    val fallbackReason: String? = null,
    val unallocatedPct: Double = 0.0,
    val sizing: List<String> = emptyList(),
) {
    val completed: Boolean get() = status == "completed"
}

/** The Monthly Picks screen as the shared TypeScript describes it. */
@Serializable
data class PicksView(
    val portfolioId: String,
    val locked: Boolean = false,
    val readOnly: Boolean = false,
    val month: String,
    val max: Int,
    val shortlist: List<String> = emptyList(),
    val budget: Double? = null,
    val counts: PicksCounts = PicksCounts(),
    val targeted: List<String> = emptyList(),
    val companies: List<PickCompany> = emptyList(),
    val run: PicksRun? = null,
    val picks: List<PickRow> = emptyList(),
    val estimateError: String? = null,
)

/** Which companies still wait on a fresh PSX scrape, from a public-analysis response. */
@Serializable
data class PicksStale(
    val stale: List<String> = emptyList(),
    val waiting: List<String> = emptyList(),
    val dispatchEnabled: Boolean = false,
)

@Serializable
data class PicksConfig(val max: Int, val gatherTimeoutMs: Long, val pollFastMs: Long, val pollSlowMs: Long)

/** Where a run is, with a percentage that only moves when real work finishes (mirrors monthly-picks-progress.ts). */
enum class PicksStep(val percent: Int) { VALIDATING(5), GATHERING(10), METRICS(60), ALLOCATING(85), SAVED(100) }

data class PicksProgress(
    val step: PicksStep,
    val completed: Int = 0,
    val total: Int = 0,
    val pending: List<String> = emptyList(),
    val degraded: Boolean = false,
) {
    /** Gathering moves inside its band with the real count of companies whose data has arrived. */
    val percent: Int
        get() =
            if (step == PicksStep.GATHERING && total > 0) {
                10 + (40.0 * completed.coerceAtMost(total) / total).toInt()
            } else {
                step.percent
            }
}
