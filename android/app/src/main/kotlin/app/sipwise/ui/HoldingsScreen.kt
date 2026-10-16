package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.sipwise.R
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SegmentedControl
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.TickerTile
import app.sipwise.designsystem.Treemap
import app.sipwise.designsystem.TreemapItem
import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.HoldingRow
import app.sipwise.model.HoldingSort
import app.sipwise.model.PortfolioSummary
import app.sipwise.model.moneyShort
import app.sipwise.model.plural
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent
import kotlinx.coroutines.delay

private const val MARKET_POLL_MS = 60_000L
private const val MARKET_IDLE_POLL_MS = 600_000L

@Composable
fun HoldingsScreen(
    viewModel: HoldingsViewModel,
    onOpenCompany: (String) -> Unit,
    onOpenInsights: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    val isAll = viewModel.scope.collectAsStateWithLifecycle().value == ALL_PORTFOLIOS
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(viewModel) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                viewModel.loadMarket()
                delay(if (viewModel.ui.value.marketOpen) MARKET_POLL_MS else MARKET_IDLE_POLL_MS)
            }
        }
    }
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        val market = ui.market
        if (market?.index != null) item { MarketCard(market, ui.marketOpen) }
        val overview = ui.overview
        if (overview == null) {
            item { SummaryCard(view.summary) }
        } else {
            item { NetWorthCard(overview, if (isAll) null else overview.portfolios.firstOrNull()?.name) }
            if (overview.total.incomplete.isNotEmpty()) {
                item { Text(overview.total.incomplete.joinToString(" "), color = SipwiseTheme.colors.warn, style = MaterialTheme.typography.bodyMedium) }
            }
            if (isAll) item { PortfolioBreakdown(overview, viewModel::openPortfolio) }
        }
        if (view.rows.isEmpty() && ui.assets.isEmpty) item { EmptyState(stringResource(R.string.nav_portfolio), stringResource(R.string.holdings_empty)) }
        if (view.rows.size >= MIN_TREEMAP) item { AllocationCard(view.rows, onOpenCompany) }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(ui.priceMessage ?: stringResource(R.string.holdings_prices_hint), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = viewModel::refreshPrices, enabled = !ui.pricing) {
                    Text(stringResource(if (ui.pricing) R.string.holdings_refreshing else R.string.holdings_refresh_prices))
                }
            }
        }
        item { OutlinedButton(onClick = onOpenInsights, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.insights_open)) } }
        item { SortRow(ui.sort, viewModel::setSort) }
        if (view.sectors.size > 1) item { SectorRow(view.sectors, ui.sector, viewModel::setSector) }
        items(view.rows, key = { it.ticker }) { HoldingItem(it, onOpenCompany) }
        if (!ui.assets.isEmpty) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) { AssetSections(ui.assets, java.time.LocalDate.now().year) }
            }
        }
        if (view.soldOut.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        pluralStringResource(R.plurals.holdings_show_sold, view.soldOut.size, view.soldOut.size),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Switch(checked = ui.showSold, onCheckedChange = viewModel::setShowSold)
                }
            }
            if (ui.showSold) items(view.soldOut, key = { "sold-${it.ticker}" }) { HoldingItem(it, onOpenCompany) }
        }
    }
}

@Composable
private fun SummaryCard(summary: PortfolioSummary) {
    NightSlab(Modifier.fillMaxWidth()) {
        Overline(stringResource(R.string.holdings_value), color = SlabColors.muted)
        MoneyText(moneyShort(summary.value), style = SipwiseNumbers.hero, color = SlabColors.ink)
        val gain = summary.gain
        if (gain != null) {
            DeltaPill("${signedMoney(gain)} (${signedPercent(summary.gainPercent)})", positive = gain >= 0, onSlab = true)
        } else if (summary.incomplete.isNotEmpty()) {
            Text(stringResource(R.string.holdings_incomplete), style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
        }
        Text(plural(summary.heldCount, "holding"), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
    }
}

private const val MIN_TREEMAP = 3

@Composable
private fun AllocationCard(
    rows: List<HoldingRow>,
    onOpen: (String) -> Unit,
) {
    val items = rows.filter { (it.value ?: 0.0) > 0 }.sortedByDescending { it.value }.map { TreemapItem(it.ticker, it.ticker, it.value ?: 0.0, it.gainPercent) }
    if (items.size < MIN_TREEMAP) return
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.holdings_allocation))
            Treemap(items, stringResource(R.string.holdings_allocation_description), onClick = onOpen)
        }
    }
}

@Composable
private fun SortRow(
    selected: HoldingSort,
    onSelect: (HoldingSort) -> Unit,
) {
    val labels = HoldingSort.entries.associateWith { stringResource(sortLabel(it)) }
    SegmentedControl(HoldingSort.entries.toList(), selected, label = { labels.getValue(it) }, onSelect = onSelect)
}

private fun sortLabel(sort: HoldingSort) =
    when (sort) {
        HoldingSort.VALUE -> R.string.sort_value
        HoldingSort.GAIN -> R.string.sort_gain
        HoldingSort.WEIGHT -> R.string.sort_weight
        HoldingSort.NAME -> R.string.sort_name
    }

@Composable
private fun SectorRow(
    sectors: List<String>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        item { FilterChip(selected = selected == null, onClick = { onSelect(null) }, label = { Text(stringResource(R.string.sector_all)) }) }
        items(sectors) { sector ->
            FilterChip(selected = sector == selected, onClick = { onSelect(sector) }, label = { Text(sector) })
        }
    }
}

@Composable
private fun HoldingItem(
    row: HoldingRow,
    onOpen: (String) -> Unit,
) {
    val description = "${row.ticker}, ${row.name}, ${moneyShort(row.value)}, ${signedPercent(row.gainPercent)}"
    SipwiseCard(
        onClick = { onOpen(row.ticker) },
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(Modifier.padding(Spacing.lg), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TickerTile(row.ticker, sector = row.sector.ifEmpty { null })
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.ticker, style = MaterialTheme.typography.titleSmall)
                Text(row.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                val priceLine =
                    if (row.price != null) {
                        pluralStringResource(R.plurals.holding_priced, row.shares.toInt(), row.shares.toLong(), shortDate(row.priceDate))
                    } else {
                        pluralStringResource(R.plurals.holding_no_price, row.shares.toInt(), row.shares.toLong())
                    }
                Text(priceLine, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (row.stale) Text(stringResource(R.string.holding_stale), style = MaterialTheme.typography.labelSmall, color = SipwiseTheme.colors.warn)
                if (row.expectedDividend) Text(stringResource(R.string.holding_dividend_expected), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MoneyText(moneyShort(row.value), style = SipwiseNumbers.medium)
                val gain = row.gain
                if (gain != null) DeltaPill(signedPercent(row.gainPercent), positive = gain >= 0)
            }
        }
    }
}
