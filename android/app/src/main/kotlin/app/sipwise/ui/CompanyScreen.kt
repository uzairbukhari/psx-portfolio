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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.ChartBar
import app.sipwise.designsystem.ChartReference
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.ChartTable
import app.sipwise.designsystem.ComboChart
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.LabelledMarker
import app.sipwise.designsystem.ListRow
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SegmentedControl
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SkeletonBlock
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StatTile
import app.sipwise.designsystem.TickerTile
import app.sipwise.designsystem.TimeSeriesChart
import app.sipwise.designsystem.ValueRow
import app.sipwise.model.ActivityEntry
import app.sipwise.model.ActivityFilter
import app.sipwise.model.CompanyView
import app.sipwise.model.DividendRow
import app.sipwise.model.HistoryRange
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun CompanyScreen(
    viewModel: CompanyViewModel,
    onOpenEntry: (String) -> Unit,
    onAdd: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    if (!view.found) {
        Text(stringResource(R.string.company_missing), modifier = Modifier.padding(Spacing.gutter))
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        item { CompanyHeader(view, onActions = { viewModel.open(CompanyDialog.Actions) }) }
        item { PriceSlab(view, ui, viewModel, onSetPrice = { viewModel.open(CompanyDialog.Price) }) }
        ui.stats?.let { stats ->
            if (stats.left.isNotEmpty() || stats.right.isNotEmpty()) item { KeyStatsCard(stats) }
        }
        item { PositionCard(view) }
        item { BrandButton(stringResource(R.string.company_add, view.ticker), onClick = onAdd) }
        item {
            val expected = view.dividends.count { it.expected }
            val dividendLabel =
                if (expected > 0) {
                    pluralStringResource(R.plurals.company_tab_dividends_expected, expected, expected)
                } else {
                    stringResource(R.string.company_tab_dividends)
                }
            val ledgerLabel = stringResource(R.string.company_tab_ledger)
            SegmentedControl(
                CompanyTab.entries.toList(),
                ui.tab,
                label = { if (it == CompanyTab.LEDGER) ledgerLabel else dividendLabel },
                onSelect = viewModel::setTab,
            )
        }
        if (ui.tab == CompanyTab.DIVIDENDS) {
            if (view.payments.size >= 2) item { DividendsChart(view) }
            if (view.dividends.isEmpty()) item { Text(stringResource(R.string.company_no_dividends)) }
            items(view.dividends, key = { it.id }) { DividendItem(it, onReceive = { viewModel.open(CompanyDialog.Received(it)) }) }
        } else {
            item { TimelineFilters(view, ui.filter, viewModel::setFilter) }
            val entries = view.entries.filter { matches(it, ui.filter) }
            if (entries.isEmpty()) {
                item {
                    Text(
                        if (view.entries.isEmpty()) stringResource(R.string.company_no_entries, view.ticker) else stringResource(R.string.company_no_entries_filtered),
                    )
                }
            }
            items(entries, key = { it.id }) { EntryItem(it, onOpen = { onOpenEntry(it.id) }) }
        }
    }
    when (val dialog = ui.dialog) {
        null -> Unit
        CompanyDialog.Price -> PriceDialog(view, ui.busy, ui.error, onSave = viewModel::savePrice, onDismiss = { viewModel.open(null) })
        CompanyDialog.Actions -> ActionsSheet(view, onPick = viewModel::open, onAdd = onAdd, onDismiss = { viewModel.open(null) })
        CompanyDialog.Edit -> EditCompanyDialog(view, ui.busy, ui.error, onSave = viewModel::saveCompany, onDismiss = { viewModel.open(null) })
        CompanyDialog.Symbol -> SymbolDialog(view, ui.busy, ui.error, onSave = viewModel::changeSymbol, onDismiss = { viewModel.open(null) })
        is CompanyDialog.Received -> ReceivedDialog(dialog.row, ui.busy, ui.error, onSave = viewModel::markReceived, onDismiss = { viewModel.open(null) })
    }
}

/** The company's name, symbol and sector, with the actions menu on the right. */
@Composable
private fun CompanyHeader(
    view: CompanyView,
    onActions: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TickerTile(view.ticker, sector = view.sector.ifEmpty { null }, size = 48.dp)
        Column(Modifier.weight(1f)) {
            Text(view.name, style = MaterialTheme.typography.titleLarge, maxLines = 2)
            Text(
                stringResource(R.string.company_subtitle, view.ticker, view.sector),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(onClick = onActions) { Text(stringResource(R.string.company_actions)) }
    }
}

/** Public key statistics in two columns, exactly as the web card lays them out. */
@Composable
private fun KeyStatsCard(stats: app.sipwise.model.CompanyStats) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.company_key_stats))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                for (column in listOf(stats.left, stats.right)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        for (row in column) ValueRow(row.label, row.value)
                    }
                }
            }
            Text(
                stringResource(R.string.company_key_stats_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PositionCard(view: CompanyView) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.company_position))
            if (!view.held) Text(stringResource(R.string.company_sold_out), style = MaterialTheme.typography.bodyMedium)
            StatRow(R.string.company_shares to shares(view.shares), R.string.company_average to money(view.average))
            StatRow(R.string.company_cost to moneyShort(view.cost), R.string.company_value to moneyShort(view.value))
            val gain = view.gain
            StatRow(
                R.string.company_unrealised to if (gain == null) "—" else "${signedMoney(gain)} (${signedPercent(view.gainPercent)})",
                R.string.company_realised to signedMoney(view.realisedProfit ?: view.realized),
            )
            view.weight?.takeIf { view.held }?.let { WeightInStocks(it) }
            if (view.cost == null && view.held) Text(stringResource(R.string.company_cost_unknown), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** How much of the stocks you hold sits in this one company, as a bar with the share beside it. */
@Composable
private fun WeightInStocks(weight: Double) {
    val percent = (weight * PERCENT).coerceIn(0.0, PERCENT)
    Column(
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        modifier = Modifier.semantics { contentDescription = "Weight in stocks, ${"%.1f".format(percent)} percent" },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                stringResource(R.string.company_weight),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            MoneyText("${"%.1f".format(percent)}%", style = SipwiseNumbers.small)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(WEIGHT_BAR)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(WEIGHT_BAR / 2)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth((percent / PERCENT).toFloat())
                    .height(WEIGHT_BAR)
                    .background(SipwiseTheme.chart.category(0), RoundedCornerShape(WEIGHT_BAR / 2)),
            )
        }
    }
}

private val WEIGHT_BAR = 6.dp
private const val PERCENT = 100.0

private fun shares(value: Double) = java.text.NumberFormat.getInstance(java.util.Locale.forLanguageTag("en-PK")).format(value)

@Composable
private fun StatRow(
    left: Pair<Int, String>,
    right: Pair<Int, String>,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        for ((label, value) in listOf(left, right)) {
            StatTile(stringResource(label), value, Modifier.weight(1f))
        }
    }
}

/**
 * The price slab: the last price, how it moved over the chosen range, the chart with your buys and sales marked and
 * your average cost dashed across it, and the range chips.
 */
@Composable
private fun PriceSlab(
    view: CompanyView,
    ui: CompanyUi,
    viewModel: CompanyViewModel,
    onSetPrice: () -> Unit,
) {
    NightSlab(Modifier.fillMaxWidth()) {
        Overline(stringResource(R.string.company_last_price), color = SlabColors.muted)
        val price = view.price
        if (price != null) {
            MoneyText(money(price), style = SipwiseNumbers.hero, color = SlabColors.ink)
            val date = shortDate(view.priceDate)
            Text(
                if (view.priceManual) stringResource(R.string.company_price_manual, date) else stringResource(R.string.company_price_asof, date),
                style = MaterialTheme.typography.bodySmall,
                color = SlabColors.muted,
            )
        } else {
            Text(stringResource(R.string.company_no_price), style = MaterialTheme.typography.titleMedium, color = SlabColors.ink)
            view.hiddenQuoteDate?.let {
                Text(stringResource(R.string.company_price_hidden, shortDate(it)), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
            }
        }
        val series = ui.series
        val spoken = stringResource(rangeSpoken(ui.range))
        val change = series?.change
        if (change != null) {
            val text =
                when {
                    change.change == 0.0 -> stringResource(R.string.company_change_flat, spoken)
                    change.change > 0 -> stringResource(R.string.company_change_up, money(change.change), signedPercent(change.percent), spoken)
                    else -> stringResource(R.string.company_change_down, money(-change.change), signedPercent(change.percent), spoken)
                }
            DeltaPill(text, positive = if (change.change == 0.0) null else change.change > 0, onSlab = true)
        }
        val chart = SipwiseTheme.chart
        when {
            ui.historyLoading -> SkeletonBlock(Modifier.fillMaxWidth().height(CHART_HEIGHT))
            ui.historyError != null ->
                Column {
                    Text(ui.historyError.orEmpty(), color = SlabColors.loss)
                    TextButton(onClick = viewModel::loadHistory) { Text(stringResource(R.string.retry), color = BrandColors.sky) }
                }
            series == null || series.points.size < 2 -> Text(stringResource(R.string.company_no_history), color = SlabColors.muted)
            else -> {
                val rising = (series.change?.change ?: 0.0) >= 0
                val label = timeLabel(ui.range)
                TimeSeriesChart(
                    series = listOf(ChartSeries(series.points, if (rising) chart.up else chart.down, fill = true)),
                    description = stringResource(R.string.company_chart_description, spoken),
                    height = CHART_HEIGHT,
                    onSlab = true,
                    xLabel = label,
                    yLabel = { money(it) },
                    scrubDetail = { _, ys -> ys.firstOrNull()?.let(::money).orEmpty() },
                    references =
                        view.average
                            ?.takeIf { view.held }
                            ?.let { listOf(ChartReference(it, stringResource(R.string.company_avg_tag), BrandColors.sky)) }
                            .orEmpty(),
                    markers =
                        view.markers.map {
                            LabelledMarker(it.x, it.y, if (it.sell) chart.down else chart.up, it.label, up = !it.sell)
                        },
                    table =
                        ChartTable(
                            title = stringResource(R.string.company_price_table, view.ticker),
                            columns = listOf(stringResource(R.string.company_table_date), stringResource(R.string.company_table_price)),
                            rows = series.points.map { listOf(label(it[0]), money(it[1])) },
                        ),
                )
            }
        }
        val ranges = HistoryRange.entries.toList()
        val labels = ranges.associateWith { stringResource(rangeShort(it)) }
        SegmentedControl(ranges, ui.range, label = { labels.getValue(it) }, onSelect = viewModel::setRange, onSlab = true)
        TextButton(onClick = onSetPrice) { Text(stringResource(R.string.company_set_price), color = BrandColors.sky) }
    }
}

/** Every dividend received, with the running total over the bars, as on the web. */
@Composable
private fun DividendsChart(view: CompanyView) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(R.string.company_dividends_received))
            val chart = SipwiseTheme.chart
            ComboChart(
                bars = view.payments.map { ChartBar(label = it.date.substring(DATE_YEAR_END), value = it.net) },
                lineLabel = stringResource(R.string.company_dividends_total),
                description = stringResource(R.string.company_dividends_chart, view.ticker),
                onSlab = false,
                barColor = chart.category(2),
                lineColor = chart.up,
                line = view.payments.map { it.total },
                valueLabel = { money(it) },
                table =
                    ChartTable(
                        title = stringResource(R.string.company_dividends_received),
                        columns =
                            listOf(
                                stringResource(R.string.company_table_date),
                                stringResource(R.string.company_table_net),
                                stringResource(R.string.company_dividends_total),
                            ),
                        rows = view.payments.map { listOf(shortDate(it.date), money(it.net), money(it.total)) },
                    ),
            )
            view.payments.lastOrNull()?.let {
                Text(
                    stringResource(R.string.company_dividends_sum, money(it.total), view.payments.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private const val DATE_YEAR_END = 5

/** Buys, sales, dividends and splits, or everything; a kind with nothing in it is not offered. */
@Composable
private fun TimelineFilters(
    view: CompanyView,
    current: ActivityFilter,
    onPick: (ActivityFilter) -> Unit,
) {
    val offered = ActivityFilter.entries.filter { it == ActivityFilter.ALL || view.entries.any { e -> matches(e, it) } }
    if (offered.size < 2) return
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items(offered, key = { it.name }) { filter ->
            FilterChip(
                selected = filter == current,
                onClick = { onPick(filter) },
                label = { Text(stringResource(filterLabel(filter))) },
            )
        }
    }
}

private fun matches(
    entry: ActivityEntry,
    filter: ActivityFilter,
): Boolean =
    when (filter) {
        ActivityFilter.ALL -> true
        ActivityFilter.BUY -> entry.kind == "buy" || entry.kind == "opening"
        ActivityFilter.SELL -> entry.kind == "sell"
        ActivityFilter.DIVIDEND -> entry.kind == "dividend"
        ActivityFilter.SPLIT -> entry.kind == "split"
    }

private fun filterLabel(filter: ActivityFilter) =
    when (filter) {
        ActivityFilter.ALL -> R.string.filter_all
        ActivityFilter.BUY -> R.string.filter_buy
        ActivityFilter.SELL -> R.string.filter_sell
        ActivityFilter.DIVIDEND -> R.string.filter_dividend
        ActivityFilter.SPLIT -> R.string.filter_split
    }

private val CHART_HEIGHT = 180.dp

/** Everything that can be done to this company, in one sheet. */
@Composable
private fun ActionsSheet(
    view: CompanyView,
    onPick: (CompanyDialog?) -> Unit,
    onAdd: () -> Unit,
    onDismiss: () -> Unit,
) {
    val known = view.portfolios.any { !it.locked }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = Spacing.xl)) {
            Text(
                view.ticker,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = Spacing.xl, vertical = Spacing.md),
            )
            HorizontalDivider()
            ListRow(
                title = stringResource(R.string.company_add, view.ticker),
                onClick = {
                    onDismiss()
                    onAdd()
                },
                modifier = Modifier.padding(horizontal = Spacing.lg),
            )
            ListRow(
                title = stringResource(R.string.company_set_price),
                onClick = { onPick(CompanyDialog.Price) },
                modifier = Modifier.padding(horizontal = Spacing.lg),
            )
            if (known) {
                ListRow(
                    title = stringResource(R.string.company_edit),
                    subtitle = stringResource(R.string.company_edit_hint),
                    onClick = { onPick(CompanyDialog.Edit) },
                    modifier = Modifier.padding(horizontal = Spacing.lg),
                )
                ListRow(
                    title = stringResource(R.string.company_change_symbol),
                    subtitle = stringResource(R.string.company_change_symbol_hint),
                    onClick = { onPick(CompanyDialog.Symbol) },
                    modifier = Modifier.padding(horizontal = Spacing.lg),
                )
            }
        }
    }
}

@Composable
private fun EditCompanyDialog(
    view: CompanyView,
    busy: Boolean,
    error: String?,
    onSave: (name: String, sector: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(view.name) }
    var sector by remember { mutableStateOf(view.sector) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.company_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.company_name_label)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = sector,
                    onValueChange = { sector = it },
                    label = { Text(stringResource(R.string.company_sector_label)) },
                    singleLine = true,
                )
                Text(stringResource(R.string.company_edit_note), style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(name, sector) }, enabled = !busy && name.isNotBlank()) {
                Text(stringResource(if (busy) R.string.entry_saving else R.string.entry_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

@Composable
private fun SymbolDialog(
    view: CompanyView,
    busy: Boolean,
    error: String?,
    onSave: (to: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var to by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.company_change_symbol)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(stringResource(R.string.company_change_symbol_body, view.ticker), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = to,
                    onValueChange = { to = it.uppercase() },
                    label = { Text(stringResource(R.string.company_new_symbol)) },
                    singleLine = true,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(to) }, enabled = !busy && to.isNotBlank()) {
                Text(stringResource(if (busy) R.string.entry_saving else R.string.company_change_symbol))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

@Composable
private fun DividendItem(
    row: DividendRow,
    onReceive: () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            val perShare = row.perShare?.let { stringResource(R.string.company_per_share, money(it)) }.orEmpty()
            Text(
                if (row.expected) stringResource(R.string.company_dividend_expected, perShare) else stringResource(R.string.company_dividend_received, perShare),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                if (row.expected) {
                    stringResource(R.string.company_book_closure, row.date)
                } else {
                    row.paymentDate?.let { stringResource(R.string.company_paid, it) } ?: stringResource(R.string.company_dated, row.date)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                (if (row.expected) "≈ " else "+") + money(row.gross),
                style = MaterialTheme.typography.titleMedium,
                color = if (row.expected) MaterialTheme.colorScheme.onSurfaceVariant else SipwiseTheme.colors.gain,
            )
            if (row.expected) TextButton(onClick = onReceive) { Text(stringResource(R.string.company_mark_received)) }
        }
    }
}

@Composable
private fun EntryItem(
    entry: ActivityEntry,
    onOpen: () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        ListRow(
            title = entry.title,
            subtitle = "${shortDate(entry.date)} · ${entry.detail}",
            onClick = if (entry.editable) onOpen else null,
            modifier = Modifier.padding(horizontal = Spacing.lg),
            trailing = { entry.amount?.let { MoneyText(money(it), style = SipwiseNumbers.small) } },
        )
    }
}

@Composable
private fun PriceDialog(
    view: CompanyView,
    busy: Boolean,
    error: String?,
    onSave: (portfolioId: String, price: String, date: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val writable = view.portfolios.filter { !it.locked }
    var portfolio by remember { mutableStateOf(writable.firstOrNull()?.id.orEmpty()) }
    var price by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(view.priceDate ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.company_price_title, view.ticker)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                if (writable.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        items(writable, key = { it.id }) {
                            FilterChip(selected = it.id == portfolio, onClick = { portfolio = it.id }, label = { Text(it.name) })
                        }
                    }
                }
                OutlinedTextField(
                    value = price,
                    onValueChange = { price = it },
                    label = { Text(stringResource(R.string.entry_price)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    value = date,
                    onValueChange = { date = it },
                    label = { Text(stringResource(R.string.entry_date)) },
                    singleLine = true,
                )
                Text(stringResource(R.string.company_price_note), style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(portfolio, price, date) }, enabled = !busy && portfolio.isNotEmpty()) {
                Text(stringResource(if (busy) R.string.entry_saving else R.string.entry_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

@Composable
private fun ReceivedDialog(
    row: DividendRow,
    busy: Boolean,
    error: String?,
    onSave: (row: DividendRow, paymentDate: String, gross: String, tax: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var date by remember { mutableStateOf(row.date) }
    var gross by remember { mutableStateOf("") }
    var tax by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.company_received_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(stringResource(R.string.company_received_body, money(row.gross), row.date), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = date,
                    onValueChange = { date = it },
                    label = { Text(stringResource(R.string.company_payment_date)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = gross,
                    onValueChange = { gross = it },
                    label = { Text(stringResource(R.string.company_gross)) },
                    supportingText = { Text(stringResource(R.string.company_gross_hint, money(row.gross))) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    value = tax,
                    onValueChange = { tax = it },
                    label = { Text(stringResource(R.string.company_tax)) },
                    supportingText = { Text(stringResource(R.string.company_tax_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(row, date, gross, tax) }, enabled = !busy) {
                Text(stringResource(if (busy) R.string.entry_saving else R.string.company_mark_received))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

private fun rangeShort(range: HistoryRange) =
    when (range) {
        HistoryRange.DAY -> R.string.range_day
        HistoryRange.WEEK -> R.string.range_week
        HistoryRange.MONTH -> R.string.range_month
        HistoryRange.MONTHS3 -> R.string.range_3m
        HistoryRange.MONTHS6 -> R.string.range_6m
        HistoryRange.YEAR -> R.string.range_year
        HistoryRange.YEARS3 -> R.string.range_3y
        HistoryRange.YEARS5 -> R.string.range_5y
    }

private fun rangeSpoken(range: HistoryRange) =
    when (range) {
        HistoryRange.DAY -> R.string.range_day_spoken
        HistoryRange.WEEK -> R.string.range_week_spoken
        HistoryRange.MONTH -> R.string.range_month_spoken
        HistoryRange.MONTHS3 -> R.string.range_3m_spoken
        HistoryRange.MONTHS6 -> R.string.range_6m_spoken
        HistoryRange.YEAR -> R.string.range_year_spoken
        HistoryRange.YEARS3 -> R.string.range_3y_spoken
        HistoryRange.YEARS5 -> R.string.range_5y_spoken
    }
