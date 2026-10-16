package app.sipwise.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.sipwise.R
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.DonutChart
import app.sipwise.designsystem.DonutSlice
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.model.AccountOverview
import app.sipwise.model.ClassTotal
import app.sipwise.model.moneyShort
import app.sipwise.model.sharePercent
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

private val LEGEND_DOT = 10.dp
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

/** Net worth for the chosen scope: a night slab with the headline and key figures, then the asset mix. */
@Composable
fun NetWorthCard(
    overview: AccountOverview,
    scopeName: String?,
) {
    val total = overview.total
    var focus by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        NightSlab(Modifier.fillMaxWidth()) {
            val label = if (scopeName == null) stringResource(R.string.overview_label_all) else stringResource(R.string.overview_label_one, scopeName)
            Overline(label, color = SlabColors.muted)
            MoneyText(moneyShort(total.value), style = SipwiseNumbers.hero, color = SlabColors.ink)
            val gain = total.gain
            if (gain == null) {
                Text(stringResource(R.string.overview_gain_unknown), style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    DeltaPill("${signedMoney(gain)} (${signedPercent(total.gainPercent)})", positive = gain >= 0, onSlab = true)
                    Text(stringResource(R.string.overview_unrealised), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
                }
            }
            HorizontalDivider(color = SlabColors.track)
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
                color = SlabColors.muted,
            )
        }
        if (overview.classes.size > 1) AssetMixCard(overview, total.value, focus) { focus = it }
    }
}

@Composable
private fun AssetMixCard(
    overview: AccountOverview,
    totalValue: Double,
    focus: String?,
    onFocus: (String?) -> Unit,
) {
    val classes = overview.classes
    val slices = classes.map { DonutSlice(it.label, it.share / PERCENT, classColor(it.key)) }
    val focusedIndex = classes.indexOfFirst { it.key == focus }.takeIf { it >= 0 }
    val focused = focusedIndex?.let { classes[it] }
    SipwiseCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(Spacing.lg), horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            DonutChart(
                slices = slices,
                focused = focusedIndex,
                centerLabel = focused?.label ?: stringResource(R.string.overview_total),
                centerValue = focused?.let { sharePercent(it.share) } ?: moneyShort(totalValue),
                description = stringResource(R.string.overview_mix_description),
                onFocus = { index -> onFocus(index?.let { classes[it].key }) },
            )
            Column(Modifier.weight(1f)) {
                classes.forEach { slice ->
                    LegendRow(slice, classColor(slice.key), focus == slice.key) { onFocus(if (focus == slice.key) null else slice.key) }
                }
            }
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
        Text(label, style = MaterialTheme.typography.labelMedium, color = SlabColors.muted, maxLines = 1)
        MoneyText(value, style = SipwiseNumbers.small, color = SlabColors.ink)
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
            Text("${moneyShort(slice.value)} · ${sharePercent(slice.share)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
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
        SipwiseCard(Modifier.fillMaxWidth()) {
            overview.portfolios.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(p.id) }.padding(Spacing.lg),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                        val locked = if (p.locked) " · " + stringResource(R.string.portfolios_locked) else ""
                        Text(stringResource(R.string.overview_portfolio_share, sharePercent(p.share)) + locked, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        MoneyText(moneyShort(p.value), style = SipwiseNumbers.small)
                        p.gain?.let {
                            val tone = if (it >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                            MoneyText(signedMoney(it), style = SipwiseNumbers.tiny, color = tone)
                        }
                    }
                }
            }
        }
    }
}
