package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.Split
import app.sipwise.designsystem.SplitBar
import app.sipwise.model.MarketSummaryBody
import app.sipwise.model.indexLevel
import app.sipwise.model.signedPercent

/** The market pulse: the KSE-100, the other indices, breadth and a day chart. Public data only. */
@Composable
fun MarketCard(
    market: MarketSummaryBody,
    open: Boolean,
) {
    val index = market.index ?: return
    val colors = SipwiseTheme.colors
    val tone = if (index.change >= 0) colors.gain else colors.loss
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Overline(stringResource(R.string.market_title))
                val state = market.market.label.ifEmpty { stringResource(if (open) R.string.market_open else R.string.market_closed) }
                Text(state, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                MoneyText(indexLevel(index.close), style = SipwiseNumbers.large)
                DeltaPill("${if (index.change >= 0) "+" else ""}${indexLevel(index.change)}  ${signedPercent(index.changePercent)}", positive = index.change >= 0)
            }
            val points = market.series.map { listOf(it.time, it.value) }
            if (points.size >= 2) {
                AreaChart(
                    series = listOf(ChartSeries(points, tone, fill = true)),
                    description = stringResource(R.string.market_chart_description),
                    height = MARKET_CHART_HEIGHT,
                    showAxes = false,
                    scrubDetail = { _, ys -> ys.firstOrNull()?.let(::indexLevel).orEmpty() },
                )
            }
            market.breadth?.let {
                val total = (it.advances + it.declines + it.unchanged).coerceAtLeast(1).toFloat()
                SplitBar(
                    listOf(Split(it.advances / total, colors.gain), Split(it.unchanged / total, MaterialTheme.colorScheme.outline), Split(it.declines / total, colors.loss)),
                )
                Text(
                    stringResource(R.string.market_breadth, it.advances, it.declines, it.unchanged),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            market.indices.forEach {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(it.label, style = MaterialTheme.typography.bodyMedium)
                    MoneyText(
                        "${indexLevel(it.close)}  ${signedPercent(it.changePercent)}",
                        style = SipwiseNumbers.small,
                        color = if (it.changePercent >= 0) colors.gain else colors.loss,
                    )
                }
            }
        }
    }
}

private val MARKET_CHART_HEIGHT = 120.dp
