package app.sipwise.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.BarRow
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.DivergingBars
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.MonthBar
import app.sipwise.designsystem.MonthBars
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SegmentedControl
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SkeletonBlock
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.TargetBar
import app.sipwise.model.InsightsView
import app.sipwise.model.TrackRange
import app.sipwise.model.TrackView
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun InsightsScreen(
    viewModel: InsightsViewModel,
    onOpenCompany: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val report = ui.report
    if (report == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    LazyColumn(contentPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item { SummaryHero(report) }
        item { TrackSection(ui, viewModel) }
        if (report.companyAllocation.isNotEmpty()) {
            item { BarsCard(R.string.insights_allocation, R.string.insights_allocation_note, report.companyAllocation.map { Triple(it.label, it.weight, it.weight) }) }
        }
        if (report.sectorAllocation.isNotEmpty()) {
            item { BarsCard(R.string.insights_sectors, R.string.insights_sectors_note, report.sectorAllocation.map { Triple(it.label, it.weight, it.weight) }) }
        }
        if (report.targets.isNotEmpty()) item { TargetsCard(report) }
        if (report.performance.isNotEmpty()) item { GainCard(report, onOpenCompany) }
        if (report.monthly.isNotEmpty()) {
            item {
                InsightCard(R.string.insights_monthly) {
                    MonthBars(report.monthly.map { MonthBar(it.month.takeLast(MONTH_LABEL), it.invested) }, stringResource(R.string.insights_monthly))
                    Text(stringResource(R.string.insights_monthly_note), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item { IncomeCard(report) }
        ui.track?.takeIf { it.benchmark.isChart }?.let { item { BenchmarkCard(it) } }
    }
}

private const val PERCENT = 100.0
private const val MONTH_LABEL = 2

@Composable
private fun InsightCard(
    title: Int,
    content: @Composable () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(title))
            content()
        }
    }
}

@Composable
private fun SummaryHero(report: InsightsView) {
    val s = report.summary
    NightSlab(Modifier.fillMaxWidth()) {
        Overline(stringResource(R.string.insights_summary), color = SlabColors.muted)
        MoneyText(moneyShort(s.pricedValue), style = SipwiseNumbers.hero, color = SlabColors.ink)
        Text(stringResource(R.string.insights_priced_value), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
        val gain = s.totalGain
        if (gain == null) {
            Text(stringResource(R.string.insights_gain_unknown), color = SlabColors.muted)
        } else {
            DeltaPill(stringResource(R.string.insights_gain, signedMoney(gain), signedPercent(s.totalGainPercent)), positive = gain >= 0, onSlab = true)
        }
        val total = s.grandTotalReturn
        Text(
            if (total == null) stringResource(R.string.insights_return_unknown) else stringResource(R.string.insights_total_return, signedMoney(total)),
            color = SlabColors.ink,
        )
        Text(stringResource(R.string.insights_return_note), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
        Text(pluralStringResource(R.plurals.insights_coverage, s.quotesHeld, s.quotesPriced, s.quotesHeld), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
        s.topThreeWeight?.let { Text(stringResource(R.string.insights_top_three, it.toInt()), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
        s.largestSector?.let {
            Text(stringResource(R.string.insights_largest_sector, it.name, it.weight.toInt()), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
        }
    }
}

@Composable
private fun BarsCard(
    title: Int,
    note: Int,
    rows: List<Triple<String, Double, Double>>,
    money: Boolean = false,
) {
    InsightCard(title) {
        for ((label, fraction, value) in rows) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label)
                Text(if (money) moneyShort(value) else stringResource(R.string.insights_percent, value), style = MaterialTheme.typography.bodySmall)
            }
            LinearProgressIndicator(progress = { (fraction / PERCENT).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        }
        Text(stringResource(note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun TargetsCard(report: InsightsView) {
    InsightCard(R.string.insights_targets) {
        for (t in report.targets) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(t.ticker, style = MaterialTheme.typography.titleSmall)
                Text(stringResource(R.string.insights_actual_target, t.actual, t.target), style = MaterialTheme.typography.bodySmall)
            }
            TargetBar(t.actual, t.target)
        }
        Text(stringResource(R.string.insights_targets_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun GainCard(
    report: InsightsView,
    onOpen: (String) -> Unit,
) {
    InsightCard(R.string.insights_gain_by_company) {
        DivergingBars(
            rows = report.performance.map { BarRow(it.ticker, it.ticker, it.gain) },
            valueLabel = { signedMoney(it) },
            description = stringResource(R.string.insights_gain_by_company),
            onClick = onOpen,
        )
        Text(stringResource(R.string.insights_gain_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun IncomeCard(report: InsightsView) {
    val r = report.realized
    InsightCard(R.string.insights_income) {
        Text(stringResource(R.string.insights_realized, money(r.totalRealizedGain), money(r.dividendsGross)))
        r.capitalGainsTax?.let { Text(stringResource(R.string.insights_cgt, money(it))) }
        if (!r.taxProfileSet) Text(stringResource(R.string.insights_set_tax), style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.insights_income_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun TrackSection(
    ui: InsightsUi,
    viewModel: InsightsViewModel,
) {
    if (ui.trackEmpty) return
    val track = ui.track
    InsightCard(R.string.insights_value_vs_in) {
        when {
            track == null && ui.trackError != null -> {
                Text(stringResource(R.string.insights_history_error), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = viewModel::retry) { Text(stringResource(R.string.retry)) }
            }
            track == null -> SkeletonBlock(Modifier.fillMaxWidth().height(TRACK_HEIGHT))
            !track.value.isChart -> Text(track.value.reason)
            else -> ValueChartBody(track)
        }
        val labels = TrackRange.entries.associateWith { stringResource(rangeLabel(it)) }
        SegmentedControl(TrackRange.entries.toList(), ui.range, label = { labels.getValue(it) }, onSelect = viewModel::setRange)
        track?.let { ReturnLine(it) }
    }
}

private val TRACK_HEIGHT = 180.dp

private fun rangeLabel(range: TrackRange) =
    when (range) {
        TrackRange.MONTH -> R.string.insights_range_1m
        TrackRange.HALF -> R.string.insights_range_6m
        TrackRange.YEAR -> R.string.insights_range_1y
        TrackRange.ALL -> R.string.insights_range_all
    }

@Composable
private fun ValueChartBody(track: TrackView) {
    val chart = track.value
    val scheme = MaterialTheme.colorScheme
    Text(chart.summary, style = MaterialTheme.typography.bodyMedium)
    AreaChart(
        series = listOf(ChartSeries(chart.value, scheme.primary, fill = true), ChartSeries(chart.moneyIn, scheme.outline, dashed = true)),
        description = chart.spoken,
        height = TRACK_HEIGHT,
        xLabel = ::dayLabel,
        scrubDetail = { _, ys -> ys.filterNotNull().joinToString(" / ") { moneyShort(it) } },
    )
    LegendRow(scheme.primary, stringResource(R.string.insights_legend_value))
    LegendRow(scheme.outline, stringResource(R.string.insights_legend_money_in))
    chart.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun ReturnLine(track: TrackView) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(stringResource(R.string.insights_mwr), style = MaterialTheme.typography.titleSmall)
        Text(track.mwr.headline ?: track.mwr.note.orEmpty(), modifier = Modifier.padding(end = Spacing.sm))
        Text(stringResource(R.string.insights_mwr_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun BenchmarkCard(track: TrackView) {
    val b = track.benchmark
    InsightCard(R.string.insights_benchmark) {
        Text(b.summary)
        AreaChart(
            series = listOf(ChartSeries(b.portfolio, MaterialTheme.colorScheme.primary), ChartSeries(b.benchmark, MaterialTheme.colorScheme.tertiary, dashed = true)),
            description = b.spoken,
            height = TRACK_HEIGHT,
            xLabel = ::dayLabel,
            scrubDetail = { _, ys -> ys.filterNotNull().joinToString(" / ") { String.format(java.util.Locale.ROOT, "%.1f", it) } },
        )
        LegendRow(MaterialTheme.colorScheme.primary, stringResource(R.string.insights_legend_portfolio))
        LegendRow(MaterialTheme.colorScheme.tertiary, b.legend)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl), verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(stringResource(R.string.insights_yours), style = MaterialTheme.typography.labelMedium)
                Text(b.yours.headline ?: b.yours.note.orEmpty())
            }
            Column {
                Text(stringResource(R.string.insights_index), style = MaterialTheme.typography.labelMedium)
                Text(b.index.headline ?: b.index.note.orEmpty())
            }
        }
        b.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

/** A colour swatch followed by what the line means. */
@Composable
private fun LegendRow(
    color: Color,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(LEGEND_SIZE)) { drawCircle(color) }
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

private val LEGEND_SIZE = 10.dp
