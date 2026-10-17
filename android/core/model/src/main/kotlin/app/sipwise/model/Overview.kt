package app.sipwise.model

import kotlinx.serialization.Serializable

/** One asset class in the net-worth mix ("stocks", "gold", "silver", "plans", "funds" or "currency"). */
@Serializable
data class ClassTotal(
    val key: String,
    val label: String,
    val value: Double = 0.0,
    /** Share of the total, 0 to 100. */
    val share: Double = 0.0,
    val cost: Double? = null,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val count: Int = 0,
    val incomplete: Boolean = false,
)

@Serializable
data class PortfolioTotal(
    val id: String,
    val name: String,
    val locked: Boolean = false,
    val value: Double = 0.0,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val share: Double = 0.0,
    val heldCount: Int = 0,
)

@Serializable
data class HoldingTotal(
    val ticker: String,
    val name: String,
    val sector: String = "",
    val value: Double = 0.0,
    val share: Double = 0.0,
    val gain: Double? = null,
    val gainPercent: Double? = null,
)

@Serializable
data class SectorTotal(val sector: String, val value: Double = 0.0, val share: Double = 0.0)

@Serializable
data class OverviewTotal(
    val value: Double = 0.0,
    val cost: Double? = null,
    val gain: Double? = null,
    val gainPercent: Double? = null,
    val incomplete: List<String> = emptyList(),
    val oldestQuoteDate: String? = null,
)

@Serializable
data class IncomeMonth(val month: String, val amount: Double = 0.0)

@Serializable
data class IncomeSummary(
    val taxYear: String = "",
    val received: Double = 0.0,
    val previousTaxYear: String = "",
    val receivedPrevious: Double = 0.0,
    val receivedTotal: Double = 0.0,
    val expected: Double = 0.0,
    val expectedCount: Int = 0,
    val months: List<IncomeMonth> = emptyList(),
)

@Serializable
data class InvestedMonth(val month: String, val amount: Double = 0.0)

@Serializable
data class InvestedSummary(val months: List<InvestedMonth> = emptyList(), val total: Double = 0.0)

/** Money-weighted yearly return as a fraction (0.075 = 7.5 %); null with a reason when it would not be honest. */
@Serializable
data class ReturnsView(val rate: Double? = null, val blockedBy: String? = null)

/** The net-worth dashboard (`overview.view`) for the chosen portfolio or all of them. */
@Serializable
data class AccountOverview(
    val asOf: String = "",
    val total: OverviewTotal = OverviewTotal(),
    val classes: List<ClassTotal> = emptyList(),
    val portfolios: List<PortfolioTotal> = emptyList(),
    val topHoldings: List<HoldingTotal> = emptyList(),
    val holdingCount: Int = 0,
    val sectors: List<SectorTotal> = emptyList(),
    val invested: InvestedSummary = InvestedSummary(),
    val income: IncomeSummary = IncomeSummary(),
    val returns: ReturnsView = ReturnsView(),
)

@Serializable
data class MetalEntryRow(
    val id: String,
    val date: String,
    val kind: String,
    val pieces: String = "",
    val amount: Double? = null,
)

@Serializable
data class MetalRateInfo(val pkrPerTola: Double = 0.0, val kind: String = "", val date: String = "")

@Serializable
data class MetalRow(
    val id: String,
    val name: String,
    val portfolio: String = "",
    val grams: Double = 0.0,
    val tola: Double = 0.0,
    val value: Double? = null,
    val gain: Double? = null,
    val costKnown: Boolean = true,
    val boughtGrams: Double = 0.0,
    val soldGrams: Double = 0.0,
    val realized: Double? = null,
    val recent: List<MetalEntryRow> = emptyList(),
    val olderCount: Int = 0,
    val rate: MetalRateInfo? = null,
)

@Serializable
data class FundPrice(val nav: Double = 0.0, val date: String = "", val source: String = "", val stale: Boolean = false)

@Serializable
data class FundRow(
    val id: String,
    val name: String,
    val amc: String = "",
    val portfolio: String = "",
    val units: Double = 0.0,
    val value: Double? = null,
    val gain: Double? = null,
    val cost: Double? = null,
    val price: FundPrice? = null,
)

@Serializable
data class FxRateInfo(val pkrPerUnit: Double = 0.0, val kind: String = "", val date: String = "", val stale: Boolean = false)

@Serializable
data class CurrencyRow(
    val id: String,
    val name: String,
    val currency: String = "",
    val heldAt: String = "",
    val portfolio: String = "",
    val units: Double = 0.0,
    val value: Double? = null,
    val gain: Double? = null,
    val cost: Double? = null,
    val realized: Double? = null,
    val rate: FxRateInfo? = null,
)

@Serializable
data class PlanAssetRow(
    val id: String,
    val name: String,
    val portfolio: String = "",
    val closed: Boolean = false,
    val value: Double = 0.0,
    val gain: Double? = null,
    val contributed: Double = 0.0,
    val redeemed: Double = 0.0,
    val cost: Double = 0.0,
    val source: String = "",
    val statementDate: String = "",
    val dueCount: Int = 0,
    val dueAmount: Double = 0.0,
)

/** Gold and silver, savings plans, mutual funds and foreign currency in the chosen scope (`assets.view`). */
@Serializable
data class AssetsView(
    val metals: List<MetalRow> = emptyList(),
    val funds: List<FundRow> = emptyList(),
    val plans: List<PlanAssetRow> = emptyList(),
    val currencies: List<CurrencyRow> = emptyList(),
) {
    val isEmpty: Boolean get() = metals.isEmpty() && funds.isEmpty() && plans.isEmpty() && currencies.isEmpty()
}

/** Which public price lists the ledger needs (`rates.wanted`), so a phone without gold or funds never asks for them. */
@Serializable
data class RatesWanted(val metals: Boolean = false, val funds: Boolean = false, val fx: Boolean = false)
