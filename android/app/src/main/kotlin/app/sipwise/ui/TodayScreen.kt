package app.sipwise.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.IconTile
import app.sipwise.designsystem.ListRow
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ProgressRing
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SegmentedControl
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SkeletonBlock
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.model.ClassTotal
import app.sipwise.model.DayMove
import app.sipwise.model.MonthProgress
import app.sipwise.model.Mover
import app.sipwise.model.NextAction
import app.sipwise.model.PortfolioSummary
import app.sipwise.model.ReturnBreakdown
import app.sipwise.model.TodayView
import app.sipwise.model.TrackRange
import app.sipwise.model.UpcomingDividend
import app.sipwise.model.moneyShort
import app.sipwise.model.monthTitle
import app.sipwise.model.plural
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Suppress("CyclomaticComplexMethod")
@Composable
fun TodayScreen(
    viewModel: TodayViewModel,
    onOpenCompany: (String) -> Unit,
    onOpenTargets: () -> Unit,
    onOpenPlan: () -> Unit,
    onAddEntry: () -> Unit,
    onOpenPortfolio: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    if (view.firstUse && !ui.skippedWelcome) {
        WelcomeCard(onAdd = onAddEntry, onSkip = viewModel::skipWelcome)
        return
    }
    if (!view.hasStocks) {
        AssetsToday(view, ui, onOpenPortfolio) { action -> if (action.key == "prices") viewModel.refreshPrices() else onOpenPlan() }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (view.firstUse) {
            item { Text(stringResource(R.string.today_first_use), style = MaterialTheme.typography.bodyLarge) }
            return@LazyColumn
        }
        view.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        item { HeroCard(view.summary, view.openCount, view.breakdown, ui.showReturn, viewModel::toggleReturn) }
        ui.move?.takeIf { it.available }?.let { move -> item { MoveCard(move, onOpenCompany) } }
        if (ui.track?.value?.isChart == true || (ui.track == null && !ui.historyFailed)) item { ValueCard(ui, viewModel) }
        item { MonthCard(view.progress) }
        if (view.upcoming.isNotEmpty()) {
            item { Text(stringResource(R.string.today_upcoming_title), style = MaterialTheme.typography.titleMedium) }
            item { UpcomingCard(view.upcoming, onOpenCompany) }
        }
        if (view.actions.isNotEmpty()) {
            item { Text(stringResource(R.string.actions_title), style = MaterialTheme.typography.titleMedium) }
            item {
                ActionsCard(view.actions, ui.pricing) { action ->
                    when (action.key) {
                        "dividend" -> action.ticker?.let(onOpenCompany)
                        "prices" -> viewModel.refreshPrices()
                        "targets" -> onOpenTargets()
                        else -> onOpenPlan()
                    }
                }
            }
        }
    }
}

/** Today for a portfolio without stocks: net worth and what it holds (funds, savings plans, gold, silver). */
@Composable
private fun AssetsToday(
    view: TodayView,
    ui: TodayUi,
    onOpenPortfolio: () -> Unit,
    onAction: (NextAction) -> Unit,
) {
    val overview = ui.overview
    if (overview == null) {
        ScreenSkeleton()
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        item { NetWorthCard(overview, overview.portfolios.singleOrNull()?.name) }
        if (overview.total.incomplete.isNotEmpty()) {
            item { Text(overview.total.incomplete.joinToString(" "), color = SipwiseTheme.colors.warn, style = MaterialTheme.typography.bodyMedium) }
        }
        item { Text(stringResource(R.string.today_assets_title), style = MaterialTheme.typography.titleMedium) }
        item { ClassesCard(overview.classes, onOpenPortfolio) }
        if (view.actions.isNotEmpty()) {
            item { Text(stringResource(R.string.actions_title), style = MaterialTheme.typography.titleMedium) }
            item { ActionsCard(view.actions, ui.pricing, onAction) }
        }
    }
}

@Composable
private fun ClassesCard(
    classes: List<ClassTotal>,
    onOpen: () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        classes.forEachIndexed { index, item ->
            ListRow(
                title = item.label,
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = plural(item.count, "holding"),
                onClick = onOpen,
                trailing = {
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        MoneyText(moneyShort(item.value), style = SipwiseNumbers.small)
                        item.gain?.let { DeltaPill(signedMoney(it), positive = it >= 0) }
                    }
                },
            )
            if (index < classes.lastIndex) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
        }
    }
}

@Composable
private fun HeroCard(
    summary: PortfolioSummary,
    openCount: Int,
    breakdown: ReturnBreakdown?,
    showReturn: Boolean,
    onToggle: () -> Unit,
) {
    NightSlab(Modifier.fillMaxWidth()) {
        val incomplete = summary.incomplete.isNotEmpty()
        Overline(stringResource(if (incomplete) R.string.today_hero_incomplete else R.string.today_hero_label), color = SlabColors.muted)
        summary.oldestQuoteDate?.let { Text(shortDate(it), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
        MoneyText(moneyShort(summary.value), style = SipwiseNumbers.hero, color = SlabColors.ink)
        val gain = summary.gain
        if (gain == null) {
            Text(stringResource(R.string.today_gain_unknown), style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                DeltaPill("${signedMoney(gain)} (${signedPercent(summary.gainPercent)})", positive = gain >= 0, onSlab = true)
                Text(stringResource(R.string.today_gain_label), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
            }
        }
        HorizontalDivider(color = SlabColors.track)
        SlabLine(stringResource(R.string.today_cost), summary.cost?.let(::moneyShort) ?: stringResource(R.string.today_not_known))
        SlabLine(stringResource(R.string.today_holdings), plural(openCount, "company", "companies"))
        if (showReturn && breakdown != null) ReturnLines(breakdown)
        TextButton(onClick = onToggle) {
            Text(stringResource(if (showReturn) R.string.today_hide_return else R.string.today_see_return), color = BrandColors.sky)
        }
    }
}

/** What the holdings gained or lost on the last trading day, with the biggest mover each way. */
@Composable
private fun MoveCard(
    move: DayMove,
    onOpenCompany: (String) -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.today_move_title))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                MoneyText(signedMoney(move.amount), style = SipwiseNumbers.large, color = moveTone(move.amount))
                DeltaPill(signedPercent(move.percent), positive = move.amount >= 0)
            }
            if (move.gainer != null || move.loser != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    MoverTile(R.string.today_move_gainer, move.gainer, onOpenCompany, Modifier.weight(1f))
                    MoverTile(R.string.today_move_loser, move.loser, onOpenCompany, Modifier.weight(1f))
                }
            }
            if (move.counted < move.of) {
                Text(
                    stringResource(R.string.today_move_partial, move.counted, move.of),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun moveTone(amount: Double) = if (amount >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss

@Composable
private fun MoverTile(
    label: Int,
    mover: Mover?,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.let { if (mover != null) it.clickable { onOpen(mover.ticker) } else it }, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(stringResource(label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (mover == null) {
            Text(stringResource(R.string.today_move_none), style = MaterialTheme.typography.bodyMedium)
        } else {
            Text(mover.ticker, style = MaterialTheme.typography.titleSmall)
            DeltaPill(signedPercent(mover.percent), positive = mover.percent >= 0)
        }
    }
}

/** The portfolio's value over the last month, six months or year, from the same history the Insights chart uses. */
@Composable
private fun ValueCard(
    ui: TodayUi,
    viewModel: TodayViewModel,
) {
    val track = ui.track
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.today_value_title))
            if (track == null) {
                SkeletonBlock(Modifier.fillMaxWidth().height(VALUE_CHART_HEIGHT))
            } else {
                Text(track.value.summary, style = MaterialTheme.typography.bodyMedium)
                AreaChart(
                    series = listOf(ChartSeries(track.value.value, MaterialTheme.colorScheme.primary, fill = true)),
                    description = track.value.spoken,
                    height = VALUE_CHART_HEIGHT,
                    xLabel = ::dayLabel,
                    scrubDetail = { _, ys -> ys.filterNotNull().joinToString(" / ") { moneyShort(it) } },
                )
            }
            val ranges = listOf(TrackRange.MONTH, TrackRange.HALF, TrackRange.YEAR)
            val labels = ranges.associateWith { stringResource(rangeLabel(it)) }
            SegmentedControl(ranges, ui.range, label = { labels.getValue(it) }, onSelect = viewModel::setRange)
        }
    }
}

private val VALUE_CHART_HEIGHT = 170.dp

private fun rangeLabel(range: TrackRange) =
    when (range) {
        TrackRange.MONTH -> R.string.insights_range_1m
        TrackRange.HALF -> R.string.insights_range_6m
        else -> R.string.insights_range_1y
    }

/** The next payouts the ledger expects: when the book closes and what it should pay. */
@Composable
private fun UpcomingCard(
    items: List<UpcomingDividend>,
    onOpenCompany: (String) -> Unit,
) {
    val year = java.time.LocalDate.now().year
    SipwiseCard(Modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            ListRow(
                title = item.ticker,
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = stringResource(R.string.today_upcoming_closure, shortDate(item.bookClosure, year)),
                onClick = { onOpenCompany(item.ticker) },
                leading = { IconTile(Icons.Outlined.Payments, SipwiseTheme.colors.gain) },
                trailing = {
                    val amount = item.amount
                    if (amount != null) {
                        MoneyText(moneyShort(amount), style = SipwiseNumbers.small)
                    } else {
                        Text(stringResource(R.string.today_upcoming_unknown), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
            )
            if (index < items.lastIndex) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
        }
    }
}

@Composable
private fun SlabLine(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
        MoneyText(value, style = SipwiseNumbers.small, color = SlabColors.ink)
    }
}

@Composable
private fun ReturnLines(b: ReturnBreakdown) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HorizontalDivider(color = SlabColors.track)
        ReturnLine(stringResource(R.string.return_unrealised), b.unrealised, colored = true)
        ReturnLine(stringResource(R.string.return_realised), b.realised, colored = true)
        ReturnLine(stringResource(R.string.return_dividends), b.dividendsReceived, colored = false)
        ReturnLine(stringResource(R.string.return_total), b.totalBeforeTax, colored = true)
        b.afterTax?.let { Text(stringResource(R.string.return_after_tax, signedMoney(it)), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
        Text(stringResource(R.string.return_note), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
    }
}

@Composable
private fun ReturnLine(
    label: String,
    value: Double?,
    colored: Boolean,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted, modifier = Modifier.weight(1f))
        when {
            value == null -> MoneyText(stringResource(R.string.today_not_known), style = SipwiseNumbers.small, color = SlabColors.muted)
            colored -> MoneyText(signedMoney(value), style = SipwiseNumbers.small, color = if (value >= 0) SlabColors.gain else SlabColors.loss)
            else -> MoneyText(moneyShort(value), style = SipwiseNumbers.small, color = SlabColors.ink)
        }
    }
}

@Composable
private fun MonthCard(progress: MonthProgress) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(Spacing.lg), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            if (progress.budgetSet) {
                ProgressRing(progress.fraction.toFloat().coerceIn(0f, 1f), centerText = "${(progress.fraction * PERCENT).toInt()}%")
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Overline(stringResource(R.string.month_title, monthTitle(progress.month)))
                if (progress.budgetSet) {
                    MoneyText(moneyShort(progress.bought), style = SipwiseNumbers.large)
                    Text(stringResource(R.string.month_of_budget, moneyShort(progress.budget)), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        if (progress.remaining > 0) stringResource(R.string.month_left, moneyShort(progress.remaining)) else stringResource(R.string.month_all_invested),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (progress.suggested > 0) {
                        Text(
                            pluralStringResource(R.plurals.month_suggested, progress.suggested, progress.suggested),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                } else {
                    Text(stringResource(R.string.month_no_budget, monthTitle(progress.month, withYear = false)), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private const val PERCENT = 100

@Composable
private fun ActionsCard(
    actions: List<NextAction>,
    pricing: Boolean,
    onAction: (NextAction) -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        actions.forEachIndexed { index, action ->
            ListRow(
                title = action.title,
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = if (action.key == "prices" && pricing) stringResource(R.string.holdings_refreshing) else action.detail,
                onClick = { onAction(action) },
                leading = { IconTile(actionIcon(action.key), actionTint(action.key)) },
            )
            if (index < actions.lastIndex) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
        }
    }
}

private fun actionIcon(key: String) =
    when (key) {
        "dividend" -> Icons.Outlined.Payments
        "prices" -> Icons.Outlined.Refresh
        "targets" -> Icons.Outlined.Flag
        else -> Icons.Outlined.Timeline
    }

@Composable
private fun actionTint(key: String) =
    when (key) {
        "dividend" -> SipwiseTheme.colors.gain
        "prices" -> SipwiseTheme.colors.assetFunds
        "targets" -> SipwiseTheme.colors.assetGold
        else -> MaterialTheme.colorScheme.primary
    }

/** First-use welcome: add a first holding or skip, like the Expo app. */
@Composable
private fun WelcomeCard(
    onAdd: () -> Unit,
    onSkip: () -> Unit,
) {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        EmptyState(stringResource(R.string.welcome_title), stringResource(R.string.welcome_subtitle))
        Overline(stringResource(R.string.welcome_start))
        SipwiseCard(Modifier.fillMaxWidth()) {
            ListRow(
                title = stringResource(R.string.welcome_add_title),
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = stringResource(R.string.welcome_add_detail),
                onClick = onAdd,
            )
            HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
            ListRow(
                title = stringResource(R.string.welcome_skip_title),
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = stringResource(R.string.welcome_skip_detail),
                onClick = onSkip,
            )
        }
        Text(stringResource(R.string.welcome_note), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}
