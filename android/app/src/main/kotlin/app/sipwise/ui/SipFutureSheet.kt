package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.ChartLayer
import app.sipwise.designsystem.ChartReference
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StackedAreaChart
import app.sipwise.model.SipComparison
import app.sipwise.model.SipExtra
import app.sipwise.model.SipFall
import app.sipwise.model.SipGoal
import app.sipwise.model.SipLevers
import app.sipwise.model.SipPause
import app.sipwise.model.SipProjection
import app.sipwise.model.SipProjectionPoint
import app.sipwise.model.SipScenarioLine
import app.sipwise.model.compactAxis
import app.sipwise.model.moneyShort
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Where this plan lands, in money of the day or today's money, and what changes if the person tries something else:
 * stop early, raise it every year, wait, take a break, a different return, a goal. Every figure and sentence comes
 * from the shared TypeScript through `sip.project`; this file only draws it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FutureSheet(
    ui: SipUi,
    viewModel: SipViewModel,
) {
    val projection = ui.projection
    ModalBottomSheet(onDismissRequest = { viewModel.open(null) }) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(start = Spacing.xl, end = Spacing.xl, bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(stringResource(R.string.sip_future), style = MaterialTheme.typography.titleLarge)
            if (projection == null) {
                Text(stringResource(R.string.sip_future_loading))
                return@Column
            }
            val comparison = projection.comparison
            if (comparison == null) PlanHeadline(projection, ui.future.real) else Takeaway(comparison.takeaway)
            if (comparison == null) PlanChart(projection, ui.future.real) else ComparisonChart(comparison, projection.startYear, ui.future.real)
            RealSwitch(ui.future.real) { on -> viewModel.project { it.copy(real = on) } }
            FutureControls(projection, ui.future, viewModel)
            if (comparison != null) ComparisonTable(comparison, projection.startYear)
            WhatIfSection(projection, ui, viewModel)
            projection.goal?.let { GoalResult(it, projection.startYear, projection.monthly) }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun PlanHeadline(
    projection: SipProjection,
    real: Boolean,
) {
    val last = projection.last
    MoneyText(moneyShort(if (real) last?.realValue else last?.value ?: 0.0), style = SipwiseNumbers.hero)
    Text(
        pluralStringResource(
            R.plurals.sip_future_summary,
            projection.years,
            projection.years,
            moneyShort(if (real) last?.realInvested else last?.invested ?: 0.0),
            "%.1f".format(projection.annual),
        ),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun Takeaway(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = SipwiseTheme.colors.gain)
}

/** "2026", "2031": a calendar year at each whole year of the axis, nothing where the tick falls between two years. */
private fun yearTick(
    x: Double,
    startYear: Int,
    years: Int,
): String {
    val whole = x.roundToInt()
    val tolerance = if (years <= FEW_YEARS) WHOLE_ONLY else NEAR_WHOLE
    return if (abs(x - whole) <= tolerance) (startYear + whole).toString() else ""
}

/** Five whole years from the start to the end of the look-ahead. */
private fun yearTicks(years: Int): List<Double> = (0..TICKS).map { (years * it / TICKS.toDouble()).roundToInt().toDouble() }.distinct()

@Composable
private fun PlanChart(
    projection: SipProjection,
    real: Boolean,
) {
    val chart = SipwiseTheme.chart

    fun paid(p: SipProjectionPoint) = if (real) p.realInvested else p.invested

    fun worth(p: SipProjectionPoint) = if (real) p.realValue else p.value

    StackedAreaChart(
        layers =
            listOf(
                ChartLayer(stringResource(R.string.sip_future_invested), projection.points.map { listOf(it.year.toDouble(), paid(it)) }, chart.neutral),
                ChartLayer(
                    stringResource(R.string.sip_future_growth),
                    projection.points.map { listOf(it.year.toDouble(), (worth(it) - paid(it)).coerceAtLeast(0.0)) },
                    chart.up,
                ),
            ),
        description = stringResource(R.string.sip_future_chart),
        xLabel = { yearTick(it, projection.startYear, projection.years) },
    )
    val marks = (if (real) projection.marks.real else projection.marks.nominal).filter { it.year != null }
    for (mark in marks) {
        Text(
            stringResource(R.string.sip_future_mark, mark.label, mark.year ?: 0),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun lineColors(): List<Color> = listOf(MaterialTheme.colorScheme.primary, SipwiseTheme.chart.category(2), SipwiseTheme.chart.category(4))

@Composable
private fun ComparisonChart(
    comparison: SipComparison,
    startYear: Int,
    real: Boolean,
) {
    val colors = lineColors()
    AreaChart(
        series =
            comparison.lines.mapIndexed { i, line ->
                ChartSeries(
                    points = line.points.map { listOf(it.year.toDouble(), if (real) it.realValue else it.value) },
                    color = colors[i % colors.size],
                    dashed = i == 0,
                )
            },
        description = stringResource(R.string.sip_whatif_chart),
        height = CHART_HEIGHT,
        xLabel = { (startYear + it.roundToInt()).toString() },
        xTicks = yearTicks(comparison.years),
        scrubDetail = { _, ys -> ys.joinToString("  ·  ") { moneyShort(it ?: 0.0) } },
    )
    Legend(comparison.lines, colors)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(
    lines: List<SipScenarioLine>,
    colors: List<Color>,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        lines.forEachIndexed { i, line ->
            Text(
                (if (i == 0) stringResource(R.string.sip_whatif_plan) else "${'A' + i - 1} · ${line.label}"),
                style = MaterialTheme.typography.labelMedium,
                color = colors[i % colors.size],
            )
        }
    }
}

@Composable
private fun ComparisonTable(
    comparison: SipComparison,
    startYear: Int,
) {
    val plan = comparison.lines.first()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        plan.checkpoints.forEachIndexed { k, cp ->
            val bold = k == plan.checkpoints.lastIndex
            TableRow(
                stringResource(R.string.sip_whatif_in_years, cp.year, startYear + cp.year),
                comparison.lines.map { it.checkpoints.getOrNull(k)?.valueLabel.orEmpty() to it.checkpoints.getOrNull(k)?.deltaLabel.orEmpty() },
                bold,
            )
        }
        TableRow(stringResource(R.string.sip_whatif_put_in), comparison.lines.map { it.investedLabel to "" })
        TableRow(stringResource(R.string.sip_whatif_growth), comparison.lines.map { it.growthLabel to "" })
        TableRow(stringResource(R.string.sip_whatif_multiple), comparison.lines.map { it.multipleLabel to "" })
    }
}

@Composable
private fun TableRow(
    label: String,
    cells: List<Pair<String, String>>,
    bold: Boolean = false,
) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            for ((value, delta) in cells) {
                Column(Modifier.weight(1f)) {
                    Text(
                        value,
                        style = if (bold) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
                    )
                    if (delta.isNotEmpty()) {
                        Text(
                            delta,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (delta.startsWith("-")) SipwiseTheme.colors.loss else SipwiseTheme.colors.gain,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RealSwitch(
    real: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.sip_future_today_money), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = real, onCheckedChange = onChange)
    }
}

/** The plan's own inputs: how much a month, how long to look ahead, the yearly raise, and whether to start from holdings. */
@Composable
private fun FutureControls(
    projection: SipProjection,
    query: SipFutureQuery,
    viewModel: SipViewModel,
) {
    var years by remember(projection.years) { mutableStateOf(projection.years.toFloat()) }
    Text(pluralStringResource(R.plurals.sip_future_years, years.toInt(), years.toInt()), style = MaterialTheme.typography.bodyMedium)
    Slider(
        value = years,
        onValueChange = { years = it },
        onValueChangeFinished = { viewModel.project { it.copy(years = years.toInt()) } },
        valueRange = MIN_YEARS..MAX_YEARS,
    )
    StepperRow(
        label = stringResource(R.string.sip_future_every_month),
        text = moneyShort(projection.monthly),
        onLess = { viewModel.project { it.copy(monthly = (projection.monthly - MONTHLY_STEP).coerceAtLeast(MONTHLY_STEP)) } },
        onMore = { viewModel.project { it.copy(monthly = projection.monthly + MONTHLY_STEP) } },
    )
    StepperRow(
        label = stringResource(R.string.sip_future_raise),
        text = "${projection.stepUp.roundToInt()}%",
        onLess = { viewModel.project { it.copy(stepUp = (projection.stepUp - 1).coerceAtLeast(0.0)) } },
        onMore = { viewModel.project { it.copy(stepUp = (projection.stepUp + 1).coerceAtMost(MAX_RAISE)) } },
    )
    if (projection.held > 0) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.sip_future_from_holdings, moneyShort(projection.held)),
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
            )
            Switch(checked = query.fromHoldings, onCheckedChange = { on -> viewModel.project { it.copy(fromHoldings = on) } })
        }
    }
}

@Composable
private fun StepperRow(
    label: String,
    text: String,
    onLess: () -> Unit,
    onMore: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onLess) { Text("−") }
        Text(text, Modifier.padding(horizontal = Spacing.md), style = SipwiseNumbers.medium)
        OutlinedButton(onClick = onMore) { Text("+") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WhatIfSection(
    projection: SipProjection,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    val query = ui.future
    val full = query.whatIfs.size >= SipViewModel.MAX_WHAT_IFS
    Text(stringResource(R.string.sip_whatif), style = MaterialTheme.typography.titleMedium)
    Text(
        stringResource(if (full) R.string.sip_whatif_full else R.string.sip_whatif_hint),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        for (preset in projection.presets) {
            val on = query.whatIfs.any { it.key == preset.key }
            FilterChip(
                selected = on,
                enabled = on || !full,
                onClick = { viewModel.togglePreset(preset) },
                label = { Text(preset.label) },
            )
        }
        FilterChip(
            selected = query.goal != null,
            onClick = { viewModel.setGoal(if (query.goal == null) SipGoalQuery(DEFAULT_GOAL) else null) },
            label = { Text(stringResource(R.string.sip_whatif_goal)) },
        )
        FilterChip(
            selected = query.builder != null,
            enabled = !full || query.builder != null,
            onClick = { if (query.builder == null) viewModel.openBuilder(query.whatIfs.size) else viewModel.cancelBuilder() },
            label = { Text(stringResource(R.string.sip_whatif_build)) },
        )
    }
    if (query.whatIfs.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            query.whatIfs.forEachIndexed { i, w ->
                TextButton(onClick = { viewModel.openBuilder(i) }) { Text(stringResource(R.string.sip_whatif_edit, "${'A' + i}")) }
                TextButton(onClick = { viewModel.removeWhatIf(w.key) }) { Text(stringResource(R.string.sip_whatif_remove, "${'A' + i}")) }
            }
        }
    }
    query.builder?.let { WhatIfBuilder(it.levers, projection, viewModel) }
    query.goal?.let { GoalForm(it, viewModel) }
}

private const val FEW_YEARS = 4
private const val WHOLE_ONLY = 0.01
private const val NEAR_WHOLE = 0.26
private const val TICKS = 4
private const val MIN_YEARS = 1f
private const val MAX_YEARS = 40f
private const val MONTHLY_STEP = 5_000.0
private const val MAX_RAISE = 30.0
private const val DEFAULT_GOAL = 6e7
private val CHART_HEIGHT = 200.dp

/** Every change a what-if can make, each behind a switch with its own stepper. */
@Composable
private fun WhatIfBuilder(
    levers: SipLevers,
    projection: SipProjection,
    viewModel: SipViewModel,
) {
    val set: (SipLevers) -> Unit = viewModel::editBuilder
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(stringResource(R.string.sip_whatif_builder_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TimingLevers(levers, set)
        MoneyLevers(levers, set, projection)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedButton(onClick = viewModel::cancelBuilder) { Text(stringResource(R.string.sip_whatif_cancel)) }
            Button(onClick = viewModel::applyBuilder, enabled = levers != SipLevers()) { Text(stringResource(R.string.sip_whatif_compare)) }
        }
    }
}

@Composable
private fun TimingLevers(
    levers: SipLevers,
    set: (SipLevers) -> Unit,
) {
    Lever(R.string.sip_lever_stop, levers.stopAfterYears != null, { on -> set(levers.copy(stopAfterYears = if (on) STOP_DEFAULT else null)) }) {
        Step("${levers.stopAfterYears ?: STOP_DEFAULT} yr", { set(levers.copy(stopAfterYears = ((levers.stopAfterYears ?: STOP_DEFAULT) - 1).coerceAtLeast(1))) }) {
            set(levers.copy(stopAfterYears = ((levers.stopAfterYears ?: STOP_DEFAULT) + 1).coerceAtMost(MAX_STOP)))
        }
    }
    Lever(R.string.sip_lever_later, levers.startDelayYears != null, { on -> set(levers.copy(startDelayYears = if (on) LATER_DEFAULT else null)) }) {
        val v = levers.startDelayYears ?: LATER_DEFAULT
        Step("$v yr", { set(levers.copy(startDelayYears = (v - 1).coerceAtLeast(1))) }) { set(levers.copy(startDelayYears = (v + 1).coerceAtMost(MAX_LATER))) }
    }
    Lever(R.string.sip_lever_break, levers.pause != null, { on -> set(levers.copy(pause = if (on) SipPause(2, BREAK_DEFAULT) else null)) }) {
        val v = levers.pause ?: SipPause(2, BREAK_DEFAULT)
        Step("${v.months} mo", { set(levers.copy(pause = v.copy(months = (v.months - 1).coerceAtLeast(1)))) }) { set(levers.copy(pause = v.copy(months = (v.months + 1).coerceAtMost(MAX_BREAK)))) }
    }
    Lever(R.string.sip_lever_skip, levers.skipMonthsPerYear != null, { on -> set(levers.copy(skipMonthsPerYear = if (on) SKIP_DEFAULT else null)) }) {
        val v = levers.skipMonthsPerYear ?: SKIP_DEFAULT
        Step("$v mo", { set(levers.copy(skipMonthsPerYear = (v - 1).coerceAtLeast(1))) }) { set(levers.copy(skipMonthsPerYear = (v + 1).coerceAtMost(MAX_SKIP))) }
    }
}

@Composable
private fun MoneyLevers(
    levers: SipLevers,
    set: (SipLevers) -> Unit,
    projection: SipProjection,
) {
    val monthly = projection.monthly
    Lever(R.string.sip_lever_raise, levers.stepUp != null, { on -> set(levers.copy(stepUp = if (on) RAISE_DEFAULT else null)) }) {
        val v = levers.stepUp ?: RAISE_DEFAULT
        Step("${v.roundToInt()}%", { set(levers.copy(stepUp = (v - 1).coerceAtLeast(0.0))) }) { set(levers.copy(stepUp = (v + 1).coerceAtMost(MAX_RAISE))) }
    }
    Lever(R.string.sip_lever_monthly, levers.monthly != null, { on -> set(levers.copy(monthly = if (on) monthly else null)) }) {
        val v = levers.monthly ?: monthly
        Step(moneyShort(v), { set(levers.copy(monthly = (v - MONTHLY_STEP).coerceAtLeast(MONTHLY_STEP))) }) { set(levers.copy(monthly = v + MONTHLY_STEP)) }
    }
    Lever(R.string.sip_lever_extra, levers.extra != null, { on -> set(levers.copy(extra = if (on) SipExtra(EXTRA_DEFAULT, 1, true) else null)) }) {
        val v = levers.extra ?: SipExtra(EXTRA_DEFAULT, 1, true)
        Step(moneyShort(v.amount), { set(levers.copy(extra = v.copy(amount = (v.amount - EXTRA_STEP).coerceAtLeast(EXTRA_STEP)))) }) { set(levers.copy(extra = v.copy(amount = v.amount + EXTRA_STEP))) }
        TextButton(onClick = { set(levers.copy(extra = v.copy(yearly = !v.yearly))) }) {
            Text(stringResource(if (v.yearly) R.string.sip_lever_extra_yearly else R.string.sip_lever_extra_once))
        }
    }
    Lever(R.string.sip_lever_return, levers.annualPct != null, { on -> set(levers.copy(annualPct = if (on) (projection.annual - RETURN_DROP).coerceAtLeast(0.0).roundToInt().toDouble() else null)) }) {
        val v = levers.annualPct ?: projection.annual
        Step("${v.roundToInt()}%", { set(levers.copy(annualPct = (v - 1).coerceAtLeast(0.0))) }) { set(levers.copy(annualPct = (v + 1).coerceAtMost(MAX_RETURN))) }
    }
    Lever(R.string.sip_lever_fall, levers.fall != null, { on -> set(levers.copy(fall = if (on) SipFall(FALL_DEFAULT, 5) else null)) }) {
        val v = levers.fall ?: SipFall(FALL_DEFAULT, 5)
        Step("${v.pct.roundToInt()}%", { set(levers.copy(fall = v.copy(pct = (v.pct - FALL_STEP).coerceAtLeast(FALL_STEP)))) }) { set(levers.copy(fall = v.copy(pct = (v.pct + FALL_STEP).coerceAtMost(MAX_FALL)))) }
    }
}

@Composable
private fun Lever(
    title: Int,
    on: Boolean,
    onToggle: (Boolean) -> Unit,
    body: @Composable () -> Unit,
) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(title), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Switch(checked = on, onCheckedChange = onToggle)
        }
        if (on) Row(verticalAlignment = Alignment.CenterVertically) { body() }
    }
}

@Composable
private fun Step(
    text: String,
    onLess: () -> Unit,
    onMore: () -> Unit,
) {
    OutlinedButton(onClick = onLess) { Text("−") }
    Text(text, Modifier.padding(horizontal = Spacing.md), style = SipwiseNumbers.medium)
    OutlinedButton(onClick = onMore) { Text("+") }
}

private const val STOP_DEFAULT = 3
private const val MAX_STOP = 30
private const val RAISE_DEFAULT = 10.0
private const val LATER_DEFAULT = 2
private const val MAX_LATER = 10
private const val BREAK_DEFAULT = 6
private const val MAX_BREAK = 24
private const val SKIP_DEFAULT = 2
private const val MAX_SKIP = 6
private const val EXTRA_DEFAULT = 100_000.0
private const val EXTRA_STEP = 25_000.0
private const val RETURN_DROP = 3.0
private const val MAX_RETURN = 40.0
private const val FALL_DEFAULT = 30.0
private const val FALL_STEP = 5.0
private const val MAX_FALL = 80.0
private const val LAKH = 1e5
private const val CRORE = 1e7

/** "I want Rs [amount] [lakh | crore] by [year, optional]". */
@Composable
private fun GoalForm(
    goal: SipGoalQuery,
    viewModel: SipViewModel,
) {
    var crore by remember { mutableStateOf(goal.target >= CRORE) }
    var amount by remember { mutableStateOf((goal.target / (if (goal.target >= CRORE) CRORE else LAKH)).toString().removeSuffix(".0")) }
    var year by remember { mutableStateOf(goal.year?.toString().orEmpty()) }

    fun push() {
        val n = amount.toDoubleOrNull() ?: return
        viewModel.setGoal(SipGoalQuery(n * (if (crore) CRORE else LAKH), year.toIntOrNull()?.takeIf { it > YEAR_FLOOR }))
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        OutlinedTextField(
            value = amount,
            onValueChange = {
                amount = it
                push()
            },
            label = { Text(stringResource(if (crore) R.string.sip_goal_amount_crore else R.string.sip_goal_amount_lakh)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FilterChip(
                selected = !crore,
                onClick = {
                    crore = false
                    push()
                },
                label = { Text(stringResource(R.string.sip_goal_lakh)) },
            )
            FilterChip(
                selected = crore,
                onClick = {
                    crore = true
                    push()
                },
                label = { Text(stringResource(R.string.sip_goal_crore)) },
            )
        }
        OutlinedTextField(
            value = year,
            onValueChange = {
                year = it.filter(Char::isDigit).take(YEAR_DIGITS)
                push()
            },
            label = { Text(stringResource(R.string.sip_goal_year)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

private const val YEAR_DIGITS = 4
private const val YEAR_FLOOR = 2000

/** What the goal needs: the takeaway, and before a deadline the monthly amount, the yearly raise and the year it takes. */
@Composable
private fun GoalResult(
    goal: SipGoal,
    startYear: Int,
    monthly: Double,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Takeaway(goal.takeaway)
        if (goal.deadlineYears != null && goal.onTrack != true) {
            WayCard(
                stringResource(R.string.sip_goal_way_monthly),
                if (goal.monthlyNeeded == null) stringResource(R.string.sip_goal_not_enough) else goal.monthlyLabel,
                if ((goal.monthlyNeeded ?: 0.0) > 0) stringResource(R.string.sip_goal_more_than_now, goal.monthlyMoreLabel) else "",
            )
            WayCard(
                stringResource(R.string.sip_goal_way_raise, moneyShort(monthly)),
                goal.stepUpNeeded?.let { "$it%" } ?: stringResource(R.string.sip_goal_over_thirty),
                "",
            )
            WayCard(
                stringResource(R.string.sip_goal_way_nothing),
                goal.reachedYear?.toString() ?: stringResource(R.string.sip_goal_not_in_fifty),
                goal.yearsToReach?.let { pluralStringResource(R.plurals.sip_goal_later, it - (goal.deadlineYears ?: 0), it - (goal.deadlineYears ?: 0)) }.orEmpty(),
            )
        }
        GoalChart(goal, startYear)
    }
}

@Composable
private fun WayCard(
    title: String,
    value: String,
    note: String,
) {
    Column {
        Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = SipwiseNumbers.medium)
        if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun GoalChart(
    goal: SipGoal,
    startYear: Int,
) {
    if (goal.lines.isEmpty()) return
    val colors = lineColors()
    val last = goal.lines.first().points.lastOrNull()?.year ?: 0
    AreaChart(
        series = goal.lines.mapIndexed { i, l -> ChartSeries(l.points.map { listOf(it.year.toDouble(), it.value) }, colors[i % colors.size], dashed = l.dashed) },
        description = stringResource(R.string.sip_goal_chart),
        height = CHART_HEIGHT,
        xLabel = { (startYear + it.roundToInt()).toString() },
        xTicks = yearTicks(last),
        references = listOf(ChartReference(goal.target, goal.targetLabel, SipwiseTheme.colors.gain)),
        yLabel = ::compactAxis,
    )
    for ((i, line) in goal.lines.withIndex()) {
        Text(line.name, style = MaterialTheme.typography.labelMedium, color = colors[i % colors.size])
    }
}
