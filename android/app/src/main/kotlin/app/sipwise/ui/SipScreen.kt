@file:OptIn(ExperimentalMaterial3Api::class)

package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.ChartLayer
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.HabitSquare
import app.sipwise.designsystem.HabitState
import app.sipwise.designsystem.MixBar
import app.sipwise.designsystem.MixSegment
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ProgressRing
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StackedAreaChart
import app.sipwise.designsystem.StatTile
import app.sipwise.model.SipClass
import app.sipwise.model.SipRow
import app.sipwise.model.SipRowAction
import app.sipwise.model.SipView
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.shortDate
import app.sipwise.designsystem.HabitStrip as HabitStripChart

/**
 * The SIP Blueprint: one plan you follow every month. The hero says where the month stands, each class row says what
 * to buy next and ticks off as you go, the habit strip shows the streak and "Future you" says where it leads.
 */
@Composable
fun SipScreen(
    viewModel: SipViewModel,
    onOpenPicks: (String) -> Unit,
    onOpenHoldings: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    if (view.setup) {
        SipWizard(view, ui, viewModel)
        return
    }
    val hero = view.hero
    val state = view.state
    LazyColumn(
        contentPadding = PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (hero != null && state != null) {
            item { SipHeroSlab(view, onEdit = { viewModel.open(SipSheet.Edit) }) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    StatTile(stringResource(R.string.sip_budget), moneyShort(state.budget), Modifier.weight(1f))
                    StatTile(stringResource(R.string.sip_this_year), moneyShort(state.year.invested), Modifier.weight(1f))
                }
            }
        }
        items(view.rows, key = { it.key }) { row ->
            SipClassRow(
                row = row,
                month = hero?.month.orEmpty(),
                busy = ui.busy,
                onAct = { act(row, view, viewModel, onOpenPicks, onOpenHoldings) },
                onMove = { row.sipClass?.let { viewModel.open(SipSheet.Move(it, row.amount)) } },
            )
        }
        if (view.edited) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.sip_edited), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = viewModel::resetPlan, enabled = !ui.busy) { Text(stringResource(R.string.sip_reset_plan)) }
                }
            }
        }
        state?.let { item { MixCard(it.values, it.mix.after) } }
        state?.let { item { HabitCard(it.strip.map { s -> HabitSquare(s.month, HabitState.parse(s.state), money(s.row.actual)) }, it.history.longest) } }
        item { FutureCard(onOpen = { viewModel.open(SipSheet.Future) }) }
        ui.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
    }
    SipSheets(view, ui, viewModel)
}

/** Whichever sheet is open over the Blueprint. */
@Composable
private fun SipSheets(
    view: SipView,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    when (val sheet = ui.sheet) {
        null -> Unit
        SipSheet.Edit -> EditPlanSheet(view, ui, viewModel)
        SipSheet.Future -> FutureSheet(ui, viewModel)
        is SipSheet.Log -> LogPurchaseSheet(sheet, view.asOf, ui, viewModel)
        is SipSheet.Move -> MovePlanSheet(sheet, ui, viewModel)
    }
}

/**
 * What the row's button does: open Monthly Picks or Holdings for the classes you choose by hand, open the log sheet
 * for gold and currency, or tick the row off (and untick one you ticked yourself).
 */
private fun act(
    row: SipRow,
    view: SipView,
    viewModel: SipViewModel,
    onOpenPicks: (String) -> Unit,
    onOpenHoldings: () -> Unit,
) {
    val month = view.hero?.month.orEmpty()
    val key = row.sipClass
    when (row.next) {
        SipRowAction.PICKS -> onOpenPicks(month)
        SipRowAction.HOLDINGS -> onOpenHoldings()
        SipRowAction.LOG -> viewModel.open(SipSheet.Log(key ?: SipClass.GOLD, row.amount, row.rate))
        SipRowAction.MARK -> mark(row, key, view.asOf, viewModel)
    }
}

private fun mark(
    row: SipRow,
    key: SipClass?,
    asOf: String,
    viewModel: SipViewModel,
) {
    if (key == null) return
    if (row.done && row.manual) viewModel.markUndone(key) else viewModel.markDone(key, row.amount, asOf)
}

/** The slab: where the month stands, how much is left, the streak and the next SIP day. */
@Composable
private fun SipHeroSlab(
    view: SipView,
    onEdit: () -> Unit,
) {
    val hero = view.hero ?: return
    val state = view.state ?: return
    NightSlab(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Overline(hero.status, color = SlabColors.muted)
                if (hero.complete) {
                    MoneyText(moneyShort(state.progress.done), style = SipwiseNumbers.hero, color = SlabColors.ink)
                    Text(stringResource(R.string.sip_all_in), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
                } else {
                    MoneyText(moneyShort(hero.left), style = SipwiseNumbers.hero, color = SlabColors.ink)
                    Text(
                        stringResource(R.string.sip_left_of, moneyShort(state.progress.planned)),
                        style = MaterialTheme.typography.bodySmall,
                        color = SlabColors.muted,
                    )
                }
            }
            ProgressRing(
                progress = (state.progress.percent / PERCENT).toFloat(),
                size = RING,
                centerText = "${state.progress.percent.toInt()}%",
            )
        }
        if (hero.streak > 0) {
            DeltaPill(stringResource(R.string.sip_streak, hero.streak), positive = true, onSlab = true)
        }
        Text(hero.encouragement, style = MaterialTheme.typography.bodyMedium, color = SlabColors.ink)
        hero.nudge?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = SlabColors.loss) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.sip_next_day, shortDate(hero.next.date), hero.next.days),
                style = MaterialTheme.typography.bodySmall,
                color = SlabColors.muted,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onEdit) { Text(stringResource(R.string.sip_edit_plan), color = BrandColors.sky) }
        }
    }
}

private val RING = 76.dp
private const val PERCENT = 100.0
private const val DIFF_FLOOR = 100.0

/** One class: what to put in, what it buys, and the button that moves it on. */
@Composable
private fun SipClassRow(
    row: SipRow,
    month: String,
    busy: Boolean,
    onAct: () -> Unit,
    onMove: () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Text(row.label, style = MaterialTheme.typography.titleMedium)
                        if (row.done) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = stringResource(R.string.sip_done),
                                tint = SipwiseTheme.colors.gain,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                    Text(row.hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(horizontalAlignment = Alignment.End) {
                    MoneyText(money(row.amount), style = SipwiseNumbers.medium)
                    if (kotlin.math.abs(row.diff) >= DIFF_FLOOR) {
                        Text(
                            if (row.diff > 0) {
                                stringResource(R.string.sip_above_target, moneyShort(row.diff))
                            } else {
                                stringResource(R.string.sip_below_target, moneyShort(-row.diff))
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (row.done && row.actual > 0) {
                Text(
                    stringResource(R.string.sip_in_this_month, money(row.actual), month),
                    style = MaterialTheme.typography.bodySmall,
                    color = SipwiseTheme.colors.gain,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(onClick = onAct, enabled = !busy) { Text(stringResource(actionLabel(row))) }
                OutlinedButton(onClick = onMove, enabled = !busy && !row.done) { Text(stringResource(R.string.sip_change_amount)) }
            }
        }
    }
}

private fun actionLabel(row: SipRow) =
    when (row.next) {
        SipRowAction.PICKS -> R.string.sip_action_picks
        SipRowAction.HOLDINGS -> R.string.sip_action_holdings
        SipRowAction.LOG -> R.string.sip_action_log
        SipRowAction.MARK -> if (row.done && row.manual) R.string.sip_action_untick else R.string.sip_action_tick
    }

/** What the mix is now and what this month's plan would leave it at. */
@Composable
private fun MixCard(
    values: Map<String, Double>,
    after: Map<String, Double>,
) {
    if (values.values.sum() <= 0.0 && after.values.sum() <= 0.0) return
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.sip_mix))
            MixBar(segments(values), labels = false)
            Text(stringResource(R.string.sip_mix_after), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            MixBar(segments(after))
        }
    }
}

@Composable
private fun segments(row: Map<String, Double>): List<MixSegment> {
    val chart = SipwiseTheme.chart
    val labels =
        mapOf(
            SipClass.STOCKS.wire to stringResource(R.string.sip_class_stocks),
            SipClass.FUNDS.wire to stringResource(R.string.sip_class_funds),
            SipClass.GOLD.wire to stringResource(R.string.sip_class_gold),
            SipClass.CURRENCY.wire to stringResource(R.string.sip_class_currency),
        )
    return SipClass.entries.mapIndexed { i, k ->
        MixSegment(labels[k.wire].orEmpty(), row[k.wire] ?: 0.0, chart.category(i))
    }
}

/** The habit: one square per month, with the best run so far. */
@Composable
private fun HabitCard(
    squares: List<HabitSquare>,
    longest: Int,
) {
    if (squares.isEmpty()) return
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Overline(stringResource(R.string.sip_habit), modifier = Modifier.weight(1f))
                Text(stringResource(R.string.sip_longest, longest), style = MaterialTheme.typography.labelSmall)
            }
            HabitStripChart(squares)
            Text(stringResource(R.string.sip_habit_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FutureCard(onOpen: () -> Unit) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(R.string.sip_future))
            Text(stringResource(R.string.sip_future_blurb), style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onOpen) { Text(stringResource(R.string.sip_future_open)) }
        }
    }
}

/** Where this plan lands: money of the day against today's money, with the milestones it passes. */
@Composable
private fun FutureSheet(
    ui: SipUi,
    viewModel: SipViewModel,
) {
    val projection = ui.projection
    var real by remember { mutableStateOf(false) }
    var years by remember(projection) { mutableStateOf((projection?.years ?: 15).toFloat()) }
    ModalBottomSheet(onDismissRequest = { viewModel.open(null) }) {
        Column(Modifier.padding(start = Spacing.xl, end = Spacing.xl, bottom = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(stringResource(R.string.sip_future), style = MaterialTheme.typography.titleLarge)
            if (projection == null) {
                Text(stringResource(R.string.sip_future_loading))
                return@Column
            }
            val last = projection.last
            val value = if (real) last?.realValue else last?.value
            val invested = if (real) last?.realInvested else last?.invested
            MoneyText(moneyShort(value ?: 0.0), style = SipwiseNumbers.hero)
            Text(
                stringResource(R.string.sip_future_summary, projection.years, moneyShort(invested ?: 0.0), "%.1f".format(projection.annual)),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val chart = SipwiseTheme.chart
            StackedAreaChart(
                layers =
                    listOf(
                        ChartLayer(
                            stringResource(R.string.sip_future_invested),
                            projection.points.map { listOf(it.year.toDouble(), if (real) it.realInvested else it.invested) },
                            chart.neutral,
                        ),
                        ChartLayer(
                            stringResource(R.string.sip_future_growth),
                            projection.points.map {
                                val v = if (real) it.realValue else it.value
                                val paid = if (real) it.realInvested else it.invested
                                listOf(it.year.toDouble(), (v - paid).coerceAtLeast(0.0))
                            },
                            chart.up,
                        ),
                    ),
                description = stringResource(R.string.sip_future_chart),
                xLabel = { stringResource(R.string.sip_future_year, it.toInt()) },
                yLabel = { moneyShort(it) },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.sip_future_today_money), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(checked = real, onCheckedChange = { real = it })
            }
            Text(stringResource(R.string.sip_future_years, years.toInt()), style = MaterialTheme.typography.bodyMedium)
            Slider(
                value = years,
                onValueChange = { years = it },
                onValueChangeFinished = { viewModel.project(years = years.toInt()) },
                valueRange = MIN_YEARS..MAX_YEARS,
                steps = (MAX_YEARS - MIN_YEARS).toInt() - 1,
            )
            val marks = (if (real) projection.marks.real else projection.marks.nominal).filter { it.year != null }
            for (mark in marks) {
                Text(
                    stringResource(R.string.sip_future_mark, mark.label, mark.year ?: 0),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                stringResource(R.string.sip_future_skip, moneyShort(if (real) projection.skip.real else projection.skip.nominal)),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private const val MIN_YEARS = 3f
private const val MAX_YEARS = 30f

/** Record a gold or currency purchase for one row: the rupees, and the grams or units the public rate works out. */
@Composable
private fun LogPurchaseSheet(
    sheet: SipSheet.Log,
    date: String,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    var amount by remember { mutableStateOf(sheet.amount.toLong().toString()) }
    var units by remember {
        val rate = sheet.rate
        mutableStateOf(if (rate != null && rate > 0) "%.3f".format(sheet.amount / rate) else "")
    }
    var currency by remember { mutableStateOf("USD") }
    val gold = sheet.key == SipClass.GOLD
    ModalBottomSheet(onDismissRequest = { viewModel.open(null) }) {
        Column(Modifier.padding(start = Spacing.xl, end = Spacing.xl, bottom = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(stringResource(if (gold) R.string.sip_log_gold else R.string.sip_log_currency), style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = amount,
                onValueChange = { typed ->
                    amount = typed
                    val rate = sheet.rate
                    val rupees = typed.toDoubleOrNull()
                    if (rate != null && rate > 0 && rupees != null) units = "%.3f".format(rupees / rate)
                },
                label = { Text(stringResource(R.string.sip_log_amount)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            OutlinedTextField(
                value = units,
                onValueChange = { units = it },
                label = { Text(stringResource(if (gold) R.string.sip_log_grams else R.string.sip_log_units)) },
                supportingText = {
                    sheet.rate?.let {
                        Text(stringResource(if (gold) R.string.sip_log_rate_gold else R.string.sip_log_rate_fx, money(it)))
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            if (!gold) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    items(listOf("USD", "AED", "SAR")) { code ->
                        FilterChip(selected = code == currency, onClick = { currency = code }, label = { Text(code) })
                    }
                }
            }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    viewModel.logPurchase(
                        sheet.key,
                        amount.toDoubleOrNull() ?: 0.0,
                        units.toDoubleOrNull() ?: 0.0,
                        date,
                        currency,
                    )
                },
                enabled = !ui.busy && amount.toDoubleOrNull() != null && units.toDoubleOrNull() != null,
            ) {
                Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.sip_log_save))
            }
        }
    }
}

/** Move one class's amount for this month; the difference goes to the rows that are not ticked off yet. */
@Composable
private fun MovePlanSheet(
    sheet: SipSheet.Move,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    var amount by remember { mutableStateOf(sheet.amount.toLong().toString()) }
    ModalBottomSheet(onDismissRequest = { viewModel.open(null) }) {
        Column(Modifier.padding(start = Spacing.xl, end = Spacing.xl, bottom = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(stringResource(R.string.sip_change_amount), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.sip_change_body), style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it },
                label = { Text(stringResource(R.string.sip_log_amount)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { viewModel.movePlan(sheet.key, amount.toDoubleOrNull() ?: 0.0) },
                enabled = !ui.busy && amount.toDoubleOrNull() != null,
            ) {
                Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.entry_save))
            }
        }
    }
}

/** The whole plan: how much a month, the split, the SIP day, rebalancing and the reminder. */
@Composable
private fun EditPlanSheet(
    view: SipView,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    val draft = ui.draft ?: return
    ModalBottomSheet(onDismissRequest = { viewModel.open(null) }) {
        Column(Modifier.padding(start = Spacing.xl, end = Spacing.xl, bottom = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(stringResource(R.string.sip_edit_plan), style = MaterialTheme.typography.titleLarge)
            BudgetField(draft.budget, view.budgetPills) { amount -> viewModel.setDraft { it.copy(budget = amount) } }
            TargetSliders(draft.targets, ui) { key, value ->
                viewModel.setDraft { it.copy(targets = it.targets + (key to value), preset = "custom") }
            }
            DayField(draft.day) { day -> viewModel.setDraft { it.copy(day = day) } }
            SwitchRow(stringResource(R.string.sip_strict), stringResource(R.string.sip_strict_hint), draft.strict) { on ->
                viewModel.setDraft { it.copy(strict = on) }
            }
            SwitchRow(stringResource(R.string.sip_notify), stringResource(R.string.sip_notify_hint), draft.notify) { on ->
                viewModel.setDraft { it.copy(notify = on) }
            }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = viewModel::save, enabled = !ui.busy && ui.preview?.valid == true) {
                Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.entry_save))
            }
        }
    }
}

/** The first run: how much, in what style, on which day. */
@Composable
private fun SipWizard(
    view: SipView,
    ui: SipUi,
    viewModel: SipViewModel,
) {
    val draft = ui.draft
    if (draft == null) {
        ScreenSkeleton()
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        item {
            NightSlab(Modifier.fillMaxWidth()) {
                Overline(stringResource(R.string.sip_wizard_label), color = SlabColors.muted)
                Text(stringResource(R.string.sip_wizard_title), style = MaterialTheme.typography.headlineSmall, color = SlabColors.ink)
                Text(stringResource(R.string.sip_wizard_blurb), style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
            }
        }
        when (ui.step) {
            0 ->
                item {
                    WizardStep(stringResource(R.string.sip_step_budget)) {
                        BudgetField(draft.budget, view.budgetPills) { amount -> viewModel.setDraft { it.copy(budget = amount) } }
                    }
                }
            1 ->
                item {
                    WizardStep(stringResource(R.string.sip_step_style)) {
                        for (preset in view.presets) {
                            PresetRow(
                                label = preset.label,
                                blurb = preset.blurb,
                                annual = preset.annual,
                                selected = draft.preset == preset.key,
                                onPick = {
                                    viewModel.setDraft {
                                        it.copy(
                                            preset = preset.key,
                                            targets = if (preset.key == "custom") it.targets else preset.targets,
                                        )
                                    }
                                },
                            )
                        }
                        if (draft.preset == "custom") {
                            TargetSliders(draft.targets, ui) { key, value ->
                                viewModel.setDraft { it.copy(targets = it.targets + (key to value)) }
                            }
                        }
                        ui.preview?.let { MixBar(segments(it.plan)) }
                    }
                }
            else ->
                item {
                    WizardStep(stringResource(R.string.sip_step_day)) {
                        DayField(draft.day) { day -> viewModel.setDraft { it.copy(day = day) } }
                        SwitchRow(stringResource(R.string.sip_notify), stringResource(R.string.sip_notify_hint), draft.notify) { on ->
                            viewModel.setDraft { it.copy(notify = on) }
                        }
                        ui.preview?.in10?.let {
                            Text(stringResource(R.string.sip_wizard_in10, it.label), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                if (ui.step > 0) OutlinedButton(onClick = { viewModel.setStep(ui.step - 1) }) { Text(stringResource(R.string.sip_back)) }
                if (ui.step < LAST_STEP) {
                    Button(onClick = { viewModel.setStep(ui.step + 1) }, enabled = draft.budget > 0) { Text(stringResource(R.string.sip_next)) }
                } else {
                    Button(onClick = viewModel::save, enabled = !ui.busy && ui.preview?.valid == true) {
                        Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.sip_start))
                    }
                }
            }
        }
        ui.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
    }
}

private const val LAST_STEP = 2

@Composable
private fun WizardStep(
    title: String,
    content: @Composable () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun PresetRow(
    label: String,
    blurb: String,
    annual: Double,
    selected: Boolean,
    onPick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onPick)
            .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            Text(blurb, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (annual > 0) MoneyText("~${annual.toInt()}%/yr", style = SipwiseNumbers.small)
            if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = SipwiseTheme.colors.gain)
        }
    }
}

@Composable
private fun BudgetField(
    budget: Double,
    pills: List<Double>,
    onSet: (Double) -> Unit,
) {
    var typed by remember(budget) { mutableStateOf(budget.toLong().toString()) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        OutlinedTextField(
            value = typed,
            onValueChange = {
                typed = it
                it.toDoubleOrNull()?.let(onSet)
            },
            label = { Text(stringResource(R.string.sip_budget)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(pills) { amount ->
                FilterChip(
                    selected = amount == budget,
                    onClick = {
                        typed = amount.toLong().toString()
                        onSet(amount)
                    },
                    label = { Text(moneyShort(amount)) },
                )
            }
        }
    }
}

/** One slider per class. The total is shown as it is typed, because the split has to come to 100%. */
@Composable
private fun TargetSliders(
    targets: Map<String, Double>,
    ui: SipUi,
    onSet: (String, Double) -> Unit,
) {
    val labels =
        mapOf(
            SipClass.STOCKS.wire to stringResource(R.string.sip_class_stocks),
            SipClass.FUNDS.wire to stringResource(R.string.sip_class_funds),
            SipClass.GOLD.wire to stringResource(R.string.sip_class_gold),
            SipClass.CURRENCY.wire to stringResource(R.string.sip_class_currency),
        )
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        for (k in SipClass.entries) {
            val value = (targets[k.wire] ?: 0.0).toFloat()
            Column {
                Row(Modifier.fillMaxWidth()) {
                    Text(labels[k.wire].orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    MoneyText("${value.toInt()}%", style = SipwiseNumbers.small)
                }
                Slider(
                    value = value,
                    onValueChange = { onSet(k.wire, it.toDouble()) },
                    valueRange = 0f..PERCENT.toFloat(),
                    steps = TARGET_STEPS,
                    modifier = Modifier.semantics { contentDescription = "${labels[k.wire]} ${value.toInt()} percent" },
                )
            }
        }
        val total = ui.preview?.total ?: targets.values.sum()
        Text(
            if (total == PERCENT) stringResource(R.string.sip_split_ok) else stringResource(R.string.sip_split_total, total.toInt()),
            style = MaterialTheme.typography.bodySmall,
            color = if (total == PERCENT) SipwiseTheme.colors.gain else MaterialTheme.colorScheme.error,
        )
    }
}

private const val TARGET_STEPS = 19

@Composable
private fun DayField(
    day: Int,
    onSet: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(stringResource(R.string.sip_day, day), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = day.toFloat(),
            onValueChange = { onSet(it.toInt().coerceIn(1, MAX_DAY)) },
            valueRange = 1f..MAX_DAY.toFloat(),
            steps = MAX_DAY - 2,
        )
        Text(stringResource(R.string.sip_day_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private const val MAX_DAY = 28

@Composable
private fun SwitchRow(
    title: String,
    hint: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
