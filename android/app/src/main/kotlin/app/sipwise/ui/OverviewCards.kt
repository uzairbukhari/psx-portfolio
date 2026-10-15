package app.sipwise.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.AccountOverview
import app.sipwise.model.ClassTotal
import app.sipwise.model.moneyShort
import app.sipwise.model.sharePercent
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

private val DONUT_SIZE = 128.dp
private val DONUT_STROKE = 14.dp
private val DONUT_STROKE_FOCUS = 20.dp
private val LEGEND_DOT = 10.dp
private const val FULL_CIRCLE = 360f
private const val TOP_ANGLE = -90f
private const val SLICE_GAP_DEGREES = 2f
private const val DIMMED_ALPHA = 0.3f
private const val PERCENT = 100.0

@Composable
private fun classColor(key: String): Color =
    when (key) {
        "funds" -> SipwiseTheme.colors.assetFunds
        "gold" -> SipwiseTheme.colors.assetGold
        "silver" -> SipwiseTheme.colors.assetSilver
        "plans" -> SipwiseTheme.colors.assetPlans
        else -> SipwiseTheme.colors.assetStocks
    }

/** Net worth for the chosen scope: headline, gain, asset-mix donut with a tappable legend, and the key figures. */
@Composable
fun NetWorthCard(
    overview: AccountOverview,
    scopeName: String?,
) {
    val total = overview.total
    var focus by remember { mutableStateOf<String?>(null) }
    val focused = overview.classes.firstOrNull { it.key == focus }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val label = if (scopeName == null) stringResource(R.string.overview_label_all) else stringResource(R.string.overview_label_one, scopeName)
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(moneyShort(total.value), style = MaterialTheme.typography.displaySmall)
            val gain = total.gain
            if (gain == null) {
                Text(stringResource(R.string.overview_gain_unknown), style = MaterialTheme.typography.bodyMedium)
            } else {
                val tone = if (gain >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                Text(
                    "${signedMoney(gain)} (${signedPercent(total.gainPercent)}) " + stringResource(R.string.overview_unrealised),
                    color = tone,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            if (overview.classes.size > 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
                    Donut(overview.classes, focused, moneyShort(total.value))
                    Column(Modifier.weight(1f)) {
                        overview.classes.forEach { slice ->
                            LegendRow(slice, classColor(slice.key), focus == slice.key) { focus = if (focus == slice.key) null else slice.key }
                        }
                    }
                }
            }
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Figure(stringResource(R.string.overview_invested), total.cost?.let { moneyShort(it) } ?: DASH, Modifier.weight(1f))
                val rate = overview.returns.rate
                Figure(stringResource(R.string.overview_yearly_return), rate?.let { signedPercent(it * PERCENT) } ?: DASH, Modifier.weight(1f))
                Figure(stringResource(R.string.overview_dividends, overview.income.taxYear), moneyShort(overview.income.received), Modifier.weight(1f))
            }
            Text(
                if (overview.returns.rate != null) {
                    stringResource(R.string.overview_return_note)
                } else {
                    overview.returns.blockedBy ?: stringResource(R.string.overview_return_blocked)
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private const val DASH = "—"

@Composable
private fun Figure(
    label: String,
    value: String,
    modifier: Modifier,
) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
        Text(value, style = MaterialTheme.typography.titleMedium, maxLines = 1)
    }
}

@Composable
private fun Donut(
    classes: List<ClassTotal>,
    focused: ClassTotal?,
    totalText: String,
) {
    val colors = classes.map { classColor(it.key) }
    val track = MaterialTheme.colorScheme.surfaceVariant
    Box(Modifier.size(DONUT_SIZE), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(DONUT_SIZE)) {
            val thick = DONUT_STROKE_FOCUS.toPx()
            val inset = thick / 2
            val arcSize = Size(size.width - thick, size.height - thick)
            drawArc(track, 0f, FULL_CIRCLE, useCenter = false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(DONUT_STROKE.toPx()))
            var start = TOP_ANGLE
            classes.forEachIndexed { i, slice ->
                val sweep = (slice.share / PERCENT).toFloat() * FULL_CIRCLE
                val on = focused?.key == slice.key
                val width = if (on) thick else DONUT_STROKE.toPx()
                val gap = if (classes.size > 1) SLICE_GAP_DEGREES else 0f
                val alpha = if (focused == null || on) 1f else DIMMED_ALPHA
                drawArc(
                    colors[i].copy(alpha = alpha),
                    start,
                    (sweep - gap).coerceAtLeast(1f),
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width, cap = StrokeCap.Butt),
                )
                start += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(focused?.label ?: stringResource(R.string.overview_total), style = MaterialTheme.typography.labelSmall, maxLines = 1)
            Text(
                focused?.let { sharePercent(it.share) } ?: totalText,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun LegendRow(
    slice: ClassTotal,
    color: Color,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    val description = "${slice.label}, ${moneyShort(slice.value)}, ${sharePercent(slice.share)}"
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(vertical = Spacing.xs).semantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Canvas(Modifier.size(LEGEND_DOT)) { drawCircle(color) }
        Column(Modifier.weight(1f)) {
            Text(
                slice.label,
                style = if (selected) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
                maxLines = 1,
            )
            Text("${moneyShort(slice.value)} · ${sharePercent(slice.share)}", style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
    }
}

/** One line per portfolio with its value and share of net worth; tapping opens it. Only for the All view. */
@Composable
fun PortfolioBreakdown(
    overview: AccountOverview,
    onOpen: (String) -> Unit,
) {
    if (overview.portfolios.size < 2) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(stringResource(R.string.overview_portfolios), style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            overview.portfolios.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider()
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(p.id) }.padding(Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
                        val locked = if (p.locked) " · " + stringResource(R.string.portfolios_locked) else ""
                        Text(stringResource(R.string.overview_portfolio_share, sharePercent(p.share)) + locked, style = MaterialTheme.typography.bodySmall)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(moneyShort(p.value), style = MaterialTheme.typography.titleSmall)
                        p.gain?.let {
                            val tone = if (it >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                            Text(signedMoney(it), color = tone, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
