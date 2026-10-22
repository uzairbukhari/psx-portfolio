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

/** A break from the SIP: [months] months off from the start of [fromYear] (1 is the first year). */
@Serializable
data class SipPause(val fromYear: Int, val months: Int)

/** Extra money at the start of [year], once or every year from then on. */
@Serializable
data class SipExtra(val amount: Double, val year: Int, val yearly: Boolean)

/** A one-time fall of [pct] percent at the start of [year]. */
@Serializable
data class SipFall(val pct: Double, val year: Int)

/** The changes a what-if makes on top of the plan; none set means the plan itself. Mirrors `SipLevers` in lib. */
@Serializable
data class SipLevers(
    val monthly: Double? = null,
    val stepUp: Double? = null,
    val stopAfterYears: Int? = null,
    val startDelayYears: Int? = null,
    val pause: SipPause? = null,
    val skipMonthsPerYear: Int? = null,
    val extra: SipExtra? = null,
    val annualPct: Double? = null,
    val fall: SipFall? = null,
)

/** A one-tap what-if sized from the person's own plan. */
@Serializable
data class SipWhatIfPreset(val key: String, val label: String, val levers: SipLevers)

/** A what-if on the way to the engine. */
@Serializable
data class SipWhatIf(val key: String, val levers: SipLevers, val label: String? = null)

/** One checkpoint year of a line, with its change against the plan in words. */
@Serializable
data class SipCheckpoint(
    val year: Int,
    val valueLabel: String,
    val deltaLabel: String = "",
    val deltaTone: String = "same",
)

/** The plan or one what-if over the look-ahead, with everything the table shows already worded. */
@Serializable
data class SipScenarioLine(
    val key: String,
    val label: String,
    val points: List<SipProjectionPoint> = emptyList(),
    val valueLabel: String = "",
    val investedLabel: String = "",
    val growthLabel: String = "",
    val multipleLabel: String = "",
    val reachedYear: Int? = null,
    val deltaLabel: String = "",
    val deltaTone: String = "same",
    val checkpoints: List<SipCheckpoint> = emptyList(),
)

/** The plan and up to two what-ifs side by side, with a one-sentence takeaway. */
@Serializable
data class SipComparison(
    val years: Int,
    val takeaway: String = "",
    val lines: List<SipScenarioLine> = emptyList(),
)

/** A line on the goal chart (the plan, or a way to close the gap). */
@Serializable
data class SipGoalLine(val name: String, val dashed: Boolean = false, val points: List<SipProjectionPoint> = emptyList())

/** "I want Rs X [by year Y]": the year the plan gets there and, before a deadline, the ways to close a gap. */
@Serializable
data class SipGoal(
    val target: Double,
    val yearsToReach: Int? = null,
    val deadlineYears: Int? = null,
    val onTrack: Boolean? = null,
    val monthlyNeeded: Double? = null,
    val stepUpNeeded: Double? = null,
    val takeaway: String = "",
    val targetLabel: String = "",
    val monthlyLabel: String = "",
    val monthlyMoreLabel: String = "",
    val reachedYear: Int? = null,
    val lines: List<SipGoalLine> = emptyList(),
)

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
    val startYear: Int = 0,
    /** What the SIP classes are worth today. */
    val held: Double = 0.0,
    /** What the projection starts from: [held], or zero when the person looks at the SIP alone. */
    val startValue: Double = 0.0,
    val points: List<SipProjectionPoint> = emptyList(),
    val last: SipProjectionPoint? = null,
    val marks: SipMarks = SipMarks(),
    val skip: SipSkipCost = SipSkipCost(),
    val presets: List<SipWhatIfPreset> = emptyList(),
    val comparison: SipComparison? = null,
    val goal: SipGoal? = null,
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
