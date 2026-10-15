package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.MarketSummaryBody
import app.sipwise.model.indexLevel
import app.sipwise.model.signedPercent

/** The market pulse: the KSE-100, the other indices, breadth and a day sparkline. Public data only. */
@Composable
fun MarketCard(
    market: MarketSummaryBody,
    open: Boolean,
) {
    val index = market.index ?: return
    val colors = SipwiseTheme.colors
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.market_title), style = MaterialTheme.typography.titleMedium)
                val state = market.market.label.ifEmpty { stringResource(if (open) R.string.market_open else R.string.market_closed) }
                Text(state, style = MaterialTheme.typography.bodySmall)
            }
            Text(indexLevel(index.close), style = MaterialTheme.typography.headlineSmall)
            Text(
                "${if (index.change >= 0) "+" else ""}${indexLevel(index.change)}  ${signedPercent(index.changePercent)}",
                color = if (index.change >= 0) colors.gain else colors.loss,
                style = MaterialTheme.typography.bodyMedium,
            )
            val points = market.series.map { listOf(it.time, it.value) }
            if (points.size >= 2) {
                MultiLineChart(
                    lines = listOf(ChartLine(points, if (index.change >= 0) colors.gain else colors.loss)),
                    description = stringResource(R.string.market_chart_description),
                )
            }
            market.breadth?.let {
                Text(
                    stringResource(R.string.market_breadth, it.advances, it.declines, it.unchanged),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            market.indices.forEach {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(it.label, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${indexLevel(it.close)}  ${signedPercent(it.changePercent)}",
                        color = if (it.changePercent >= 0) colors.gain else colors.loss,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}
