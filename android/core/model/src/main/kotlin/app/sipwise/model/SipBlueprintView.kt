package app.sipwise.model

import kotlinx.serialization.Serializable

/** The four SIP classes, in the order the engine lists them. */
enum class SipClass(val wire: String) {
    STOCKS("stocks"),
    FUNDS("funds"),
    GOLD("gold"),
    CURRENCY("currency"),
    ;

    companion object {
        fun parse(value: String): SipClass? = entries.firstOrNull { it.wire == value }
    }
}

/** What a class row offers next: pick stocks, add to a fund, log a purchase here, or only tick it off. */
enum class SipRowAction(val wire: String) {
    PICKS("picks"),
    HOLDINGS("holdings"),
    LOG("log"),
    MARK("mark"),
    ;

    companion object {
        fun parse(value: String): SipRowAction = entries.firstOrNull { it.wire == value } ?: MARK
    }
}

@Serializable
data class SipMonthProgress(val planned: Double = 0.0, val done: Double = 0.0, val percent: Double = 0.0)

@Serializable
data class SipMonthRow(val month: String, val target: Double, val actual: Double, val met: Boolean)

@Serializable
data class SipHistory(
    val rows: List<SipMonthRow> = emptyList(),
    val streak: Int = 0,
    val longest: Int = 0,
    val thisMonthMet: Boolean = false,
)

/** One square of the habit strip. [state] is met, partial, missed, current or before. */
@Serializable
data class SipHabitSquare(val month: String, val state: String, val row: SipMonthRow)

/**
 * What the plan would leave the mix at: the share of each class now ([now], null while nothing is held) and after
 * this month's buys.
 */
@Serializable
data class SipMix(val now: Map<String, Double>? = null, val after: Map<String, Double> = emptyMap())

@Serializable
data class SipYear(val invested: Double = 0.0, val monthsMet: Int = 0)

/** The running month, worked out once by the engine. */
@Serializable
data class SipMonthState(
    val month: String,
    val budget: Double,
    val plan: Map<String, Double> = emptyMap(),
    val suggested: Map<String, Double> = emptyMap(),
    val actual: Map<String, Double> = emptyMap(),
    val done: Map<String, Boolean> = emptyMap(),
    val progress: SipMonthProgress = SipMonthProgress(),
    val history: SipHistory = SipHistory(),
    val strip: List<SipHabitSquare> = emptyList(),
    val values: Map<String, Double> = emptyMap(),
    val weights: Map<String, Double>? = null,
    val mix: SipMix = SipMix(),
    val year: SipYear = SipYear(),
)

@Serializable
data class SipNextDay(val date: String, val days: Int)

/** The slab at the top of the SIP Blueprint: where the month stands, in words. */
@Serializable
data class SipHero(
    val month: String,
    val status: String,
    val complete: Boolean = false,
    val left: Double = 0.0,
    val next: SipNextDay,
    val streak: Int = 0,
    val encouragement: String = "",
    val nudge: String? = null,
)

/** One class row: what to buy, how much, and what the button does. */
@Serializable
data class SipRow(
    val key: String,
    val label: String,
    val hint: String = "",
    val amount: Double = 0.0,
    val target: Double = 0.0,
    val diff: Double = 0.0,
    val actual: Double = 0.0,
    val done: Boolean = false,
    val manual: Boolean = false,
    val action: String = "mark",
    val rate: Double? = null,
) {
    val sipClass: SipClass? get() = SipClass.parse(key)
    val next: SipRowAction get() = SipRowAction.parse(action)
}

/** One month's record inside the stored blueprint. */
@Serializable
data class SipMonthRecord(
    val budget: Double,
    val plan: Map<String, Double> = emptyMap(),
    val done: Map<String, SipDoneEntry> = emptyMap(),
    val edited: Boolean? = null,
)

@Serializable
data class SipDoneEntry(val amount: Double, val date: String)

/** The stored plan itself (inside the encrypted ledger), as the engine hands it over. */
@Serializable
data class SipBlueprint(
    val budget: Double,
    val targets: Map<String, Double> = emptyMap(),
    val day: Int? = null,
    val strict: Boolean = false,
    val stepUp: Double? = null,
    val returns: Map<String, Double> = emptyMap(),
    val notify: Boolean = false,
    val since: String = "",
    val months: Map<String, SipMonthRecord> = emptyMap(),
)

/** One style in the setup wizard. */
@Serializable
data class SipPreset(
    val key: String,
    val label: String,
    val blurb: String = "",
    val targets: Map<String, Double> = emptyMap(),
    val annual: Double = 0.0,
)

/**
 * The SIP Blueprint screen (`sip.view`). While [setup] is true no plan exists yet and the wizard opens with
 * [presets], [budgetPills] and [blank]; otherwise [hero], [rows] and [state] carry the running month.
 */
@Serializable
data class SipView(
    val setup: Boolean,
    val asOf: String,
    val month: String = "",
    val canLog: Boolean = false,
    val classes: List<String> = emptyList(),
    val labels: Map<String, String> = emptyMap(),
    val budgetPills: List<Double> = emptyList(),
    val streakThreshold: Double = 0.8,
    val presets: List<SipPreset> = emptyList(),
    val blank: SipBlueprint? = null,
    val blueprint: SipBlueprint? = null,
    val annual: Double = 0.0,
    val hero: SipHero? = null,
    val rows: List<SipRow> = emptyList(),
    val state: SipMonthState? = null,
    val edited: Boolean = false,
    val strict: Boolean = false,
    val day: Int = 1,
)

@Serializable
data class SipHeld(val values: Map<String, Double> = emptyMap(), val weights: Map<String, Double>? = null, val total: Double = 0.0)

@Serializable
data class SipDecade(val invested: Double, val value: Double, val label: String)

/** The live answer under the wizard and the edit sheet for a draft that is not saved yet (`sip.preview`). */
@Serializable
data class SipPreview(
    val plan: Map<String, Double> = emptyMap(),
    val total: Double = 0.0,
    val valid: Boolean = false,
    val annual: Double = 0.0,
    val mix: SipMix = SipMix(),
    val held: SipHeld = SipHeld(),
    val in10: SipDecade? = null,
    val hints: Map<String, String> = emptyMap(),
)

/** One year of the projection, in money of the day and in today's money. */
@Serializable
data class SipProjectionPoint(
    val year: Int,
    val invested: Double,
    val value: Double,
    val realInvested: Double,
    val realValue: Double,
)

/** A milestone the projection passes ("Rs 10 lakh in year 6"). */
@Serializable
data class SipMilestone(val level: Double, val year: Int? = null, val label: String = "")

@Serializable
data class SipMarks(val nominal: List<SipMilestone> = emptyList(), val real: List<SipMilestone> = emptyList())

@Serializable
data class SipSkipCost(val nominal: Double = 0.0, val real: Double = 0.0)

/** "Future you" (`sip.project`). */
@Serializable
data class SipProjection(
    val monthly: Double,
    val years: Int,
    val stepUp: Double,
    val returns: Map<String, Double> = emptyMap(),
    val annual: Double = 0.0,
    val inflation: Double = 0.0,
    val defaults: Map<String, Double> = emptyMap(),
    val points: List<SipProjectionPoint> = emptyList(),
    val last: SipProjectionPoint? = null,
    val marks: SipMarks = SipMarks(),
    val skip: SipSkipCost = SipSkipCost(),
)

/** One stepper move, before it is saved (`sip.rebalance`). */
@Serializable
data class SipRebalance(
    val plan: Map<String, Double> = emptyMap(),
    val locked: List<String> = emptyList(),
    val budget: Double = 0.0,
    val suggested: Map<String, Double> = emptyMap(),
    val total: Double = 0.0,
    val mix: SipMix = SipMix(),
    val hints: Map<String, String> = emptyMap(),
)
