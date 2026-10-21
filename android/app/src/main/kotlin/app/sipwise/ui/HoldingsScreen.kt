package app.sipwise.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
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
import app.sipwise.designsystem.ChartBar
import app.sipwise.designsystem.ComboChart
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.MixBar
import app.sipwise.designsystem.MixSegment
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
import app.sipwise.model.AssetTotal
import app.sipwise.model.HoldingRow
import app.sipwise.model.HoldingSort
import app.sipwise.model.InvestedMonth
import app.sipwise.model.PortfolioSummary
import app.sipwise.model.SectorTotal
import app.sipwise.model.moneyShort
import app.sipwise.model.monthShort
import app.sipwise.model.plural
import app.sipwise.model.sharePercent
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent
import kotlinx.coroutines.delay

private const val MARKET_POLL_MS = 60_000L
private const val MARKET_IDLE_POLL_MS = 600_000L

@Suppress("CyclomaticComplexMethod")
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
        val hasStocks = view.rows.isNotEmpty() || view.soldOut.isNotEmpty()
        if (hasStocks && market?.index != null) item { MarketCard(market, ui.marketOpen) }
        val overview = ui.overview
        if (overview == null) {
            item { SummaryCard(view.summary) }
        } else {
            item { NetWorthCard(overview, if (isAll) null else overview.portfolios.firstOrNull()?.name) }
            if (overview.total.incomplete.isNotEmpty()) {
                item { Text(overview.total.incomplete.joinToString(" "), color = SipwiseTheme.colors.warn, style = MaterialTheme.typography.bodyMedium) }
            }
            if (isAll) item { PortfolioBreakdown(overview, viewModel::openPortfolio) }
            if (overview.sectors.size > 1 && hasStocks) item { SectorsCard(overview.sectors) }
            if (!hasStocks && overview.topAssets.isNotEmpty()) item { LargestAssetsCard(overview.topAssets) }
            if (!hasStocks && overview.invested.months.size > 1) item { MoneyInCard(overview.invested.months) }
        }
        if (view.rows.isEmpty() && ui.assets.isEmpty) item { EmptyState(stringResource(R.string.nav_portfolio), stringResource(R.string.holdings_empty)) }
        if (view.rows.size >= MIN_TREEMAP) item { AllocationCard(view.rows, onOpenCompany) }
        if (hasStocks) {
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
        }
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
private const val TREEMAP_TILES = 8
private const val OTHERS_ID = "others"
private val TREEMAP_HEIGHT = 230.dp

@Composable
private fun AllocationCard(
    rows: List<HoldingRow>,
    onOpen: (String) -> Unit,
) {
    val ranked = rows.filter { (it.value ?: 0.0) > 0 }.sortedByDescending { it.value }
    val top = ranked.take(TREEMAP_TILES).map { TreemapItem(it.ticker, it.ticker, it.value ?: 0.0, it.gainPercent) }
    val rest = ranked.drop(TREEMAP_TILES)
    val others = if (rest.isEmpty()) emptyList() else listOf(TreemapItem(OTHERS_ID, stringResource(R.string.holdings_allocation_others, rest.size), rest.sumOf { it.value ?: 0.0 }, null))
    val items = top + others
    if (items.size < MIN_TREEMAP) return
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.holdings_allocation))
            Treemap(items, stringResource(R.string.holdings_allocation_description), height = TREEMAP_HEIGHT, onClick = { if (it != OTHERS_ID) onOpen(it) })
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
                row.weight?.takeIf { it > 0 }?.let { WeightBar(it, row.sector) }
            }
        }
    }
}

/** How much of the stocks this holding is, as a short bar in its sector's colour. */
@Composable
private fun WeightBar(
    weight: Double,
    sector: String,
) {
    val full = (weight / PERCENT).toFloat().coerceIn(0f, 1f)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(sharePercent(weight), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(
            Modifier
                .width(WEIGHT_WIDTH)
                .height(WEIGHT_HEIGHT)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(WEIGHT_HEIGHT / 2)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(full)
                    .height(WEIGHT_HEIGHT)
                    .background(sectorColor(sector), RoundedCornerShape(WEIGHT_HEIGHT / 2)),
            )
        }
    }
}

private const val PERCENT = 100.0
private val WEIGHT_WIDTH = 56.dp
private val WEIGHT_HEIGHT = 6.dp

/** One colour per sector, stable for a sector name, from the same palette the charts use. */
@Composable
private fun sectorColor(sector: String): Color =
    if (sector.isEmpty()) SipwiseTheme.chart.other else SipwiseTheme.chart.category(sector.hashCode())

/** The web's Sectors card: each sector's share of the stocks, biggest first. */
@Composable
private fun SectorsCard(sectors: List<SectorTotal>) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.holdings_sectors))
            MixBar(sectors.map { MixSegment(it.sector, it.share, sectorColor(it.sector)) }, labels = false)
            sectors.forEach {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Box(Modifier.size(DOT).background(sectorColor(it.sector), RoundedCornerShape(DOT / 2)))
                    Text(it.sector, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1)
                    Text(sharePercent(it.share), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    MoneyText(moneyShort(it.value), style = SipwiseNumbers.small)
                }
            }
        }
    }
}

private val DOT = 10.dp

/** For a portfolio without stocks: its largest funds, metal holdings, plans and currency. */
@Composable
private fun LargestAssetsCard(assets: List<AssetTotal>) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.holdings_largest))
            assets.forEach {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Column(Modifier.weight(1f)) {
                        Text(it.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                        Text(sharePercent(it.share), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    MoneyText(moneyShort(it.value), style = SipwiseNumbers.small)
                    it.gain?.let { gain -> DeltaPill(signedMoney(gain), positive = gain >= 0) }
                }
            }
        }
    }
}

/** Money paid in per month over the last year, bars with the running total over them. */
@Composable
private fun MoneyInCard(months: List<InvestedMonth>) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.holdings_money_in))
            ComboChart(
                bars = months.map { ChartBar(monthShort(it.month), it.amount) },
                lineLabel = stringResource(R.string.holdings_money_in_total),
                description = stringResource(R.string.holdings_money_in_description),
                valueLabel = ::moneyShort,
            )
        }
    }
}
