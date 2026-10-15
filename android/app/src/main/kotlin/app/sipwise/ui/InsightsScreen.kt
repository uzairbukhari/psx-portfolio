package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.InsightsView
import app.sipwise.model.TrackRange
import app.sipwise.model.TrackView
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun InsightsScreen(viewModel: InsightsViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val report = ui.report
    if (report == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item { SummaryHero(report) }
        item { TrackSection(ui, viewModel) }
        if (report.companyAllocation.isNotEmpty()) {
            item { BarsCard(R.string.insights_allocation, R.string.insights_allocation_note, report.companyAllocation.map { Triple(it.label, it.weight, it.weight) }) }
        }
        if (report.sectorAllocation.isNotEmpty()) {
            item { BarsCard(R.string.insights_sectors, R.string.insights_sectors_note, report.sectorAllocation.map { Triple(it.label, it.weight, it.weight) }) }
        }
        if (report.targets.isNotEmpty()) item { TargetsCard(report) }
        if (report.performance.isNotEmpty()) item { GainCard(report) }
        if (report.monthly.isNotEmpty()) {
            val top = report.monthly.maxOf { it.invested }.coerceAtLeast(1.0)
            item { BarsCard(R.string.insights_monthly, R.string.insights_monthly_note, report.monthly.map { Triple(it.month, it.invested / top * PERCENT, it.invested) }, money = true) }
        }
        item { IncomeCard(report) }
        ui.track?.takeIf { it.benchmark.isChart }?.let { item { BenchmarkCard(it) } }
    }
}

private const val PERCENT = 100.0

@Composable
private fun gainColor(gain: Double?) =
    when {
        gain == null -> MaterialTheme.colorScheme.onSurface
        gain >= 0 -> SipwiseTheme.colors.gain
        else -> SipwiseTheme.colors.loss
    }

@Composable
private fun InsightCard(
    title: Int,
    content: @Composable () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun SummaryHero(report: InsightsView) {
    val s = report.summary
    InsightCard(R.string.insights_summary) {
        Text(moneyShort(s.pricedValue), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.insights_priced_value), style = MaterialTheme.typography.bodySmall)
        val gain = s.totalGain
        Text(
            if (gain == null) stringResource(R.string.insights_gain_unknown) else stringResource(R.string.insights_gain, signedMoney(gain), signedPercent(s.totalGainPercent)),
            color = gainColor(gain),
        )
        val total = s.grandTotalReturn
        Text(if (total == null) stringResource(R.string.insights_return_unknown) else stringResource(R.string.insights_total_return, signedMoney(total)))
        Text(stringResource(R.string.insights_return_note), style = MaterialTheme.typography.bodySmall)
        Text(pluralStringResource(R.plurals.insights_coverage, s.quotesHeld, s.quotesPriced, s.quotesHeld), style = MaterialTheme.typography.bodySmall)
        s.topThreeWeight?.let { Text(stringResource(R.string.insights_top_three, it.toInt()), style = MaterialTheme.typography.bodySmall) }
        s.largestSector?.let { Text(stringResource(R.string.insights_largest_sector, it.name, it.weight.toInt()), style = MaterialTheme.typography.bodySmall) }
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
                Text(t.ticker)
                Text(stringResource(R.string.insights_actual_target, t.actual, t.target))
            }
        }
        Text(stringResource(R.string.insights_targets_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun GainCard(report: InsightsView) {
    InsightCard(R.string.insights_gain_by_company) {
        for (g in report.performance) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(g.ticker)
                Text(
                    "${signedMoney(g.gain)} (${signedPercent(g.gainPercent)})",
                    color = if (g.gain >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss,
                )
            }
        }
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
            track == null -> Text(stringResource(R.string.insights_history_loading))
            !track.value.isChart -> Text(track.value.reason)
            else -> ValueChartBody(track)
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(TrackRange.entries) { range ->
                FilterChip(selected = ui.range == range, onClick = { viewModel.setRange(range) }, label = { Text(stringResource(rangeLabel(range))) })
            }
        }
        track?.let { ReturnLine(it) }
    }
}

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
    Text(chart.summary)
    MultiLineChart(
        lines = listOf(ChartLine(chart.value, MaterialTheme.colorScheme.primary), ChartLine(chart.moneyIn, MaterialTheme.colorScheme.outline, dashed = true)),
        description = chart.spoken,
    )
    LegendRow(MaterialTheme.colorScheme.primary, stringResource(R.string.insights_legend_value))
    LegendRow(MaterialTheme.colorScheme.outline, stringResource(R.string.insights_legend_money_in))
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
        MultiLineChart(
            lines = listOf(ChartLine(b.portfolio, MaterialTheme.colorScheme.primary), ChartLine(b.benchmark, MaterialTheme.colorScheme.tertiary, dashed = true)),
            description = b.spoken,
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
