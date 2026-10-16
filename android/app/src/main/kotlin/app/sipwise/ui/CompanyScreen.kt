package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.ChartReference
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.DeltaPill
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
import app.sipwise.model.ActivityEntry
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
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                TickerTile(view.ticker, sector = view.sector.ifEmpty { null }, size = 48.dp)
                Column {
                    Text(view.name, style = MaterialTheme.typography.titleLarge, maxLines = 2)
                    Text(stringResource(R.string.company_subtitle, view.ticker, view.sector), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item { HeroCard(view, ui, viewModel, onSetPrice = { viewModel.open(CompanyDialog.Price) }) }
        item { PositionCard(view) }
        item { BrandButton(stringResource(R.string.company_add, view.ticker), onClick = onAdd) }
        item {
            val expected = view.dividends.count { it.expected }
            val dividendLabel =
                if (expected > 0) pluralStringResource(R.plurals.company_tab_dividends_expected, expected, expected) else stringResource(R.string.company_tab_dividends)
            val ledgerLabel = stringResource(R.string.company_tab_ledger)
            SegmentedControl(
                CompanyTab.entries.toList(),
                ui.tab,
                label = { if (it == CompanyTab.LEDGER) ledgerLabel else dividendLabel },
                onSelect = viewModel::setTab,
            )
        }
        if (ui.tab == CompanyTab.DIVIDENDS) {
            if (view.dividends.isEmpty()) item { Text(stringResource(R.string.company_no_dividends)) }
            items(view.dividends, key = { it.id }) { DividendItem(it, onReceive = { viewModel.open(CompanyDialog.Received(it)) }) }
        } else {
            if (view.entries.isEmpty()) item { Text(stringResource(R.string.company_no_entries, view.ticker)) }
            items(view.entries, key = { it.id }) { EntryItem(it, onOpen = { onOpenEntry(it.id) }) }
        }
    }
    when (val dialog = ui.dialog) {
        null -> Unit
        CompanyDialog.Price -> PriceDialog(view, ui.busy, ui.error, onSave = viewModel::savePrice, onDismiss = { viewModel.open(null) })
        is CompanyDialog.Received -> ReceivedDialog(dialog.row, ui.busy, ui.error, onSave = viewModel::markReceived, onDismiss = { viewModel.open(null) })
    }
}

@Composable
private fun PositionCard(view: CompanyView) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Overline(stringResource(R.string.company_position))
            if (view.shares == 0.0) Text(stringResource(R.string.company_sold_out), style = MaterialTheme.typography.bodyMedium)
            StatRow(R.string.company_shares to shares(view.shares), R.string.company_average to money(view.average))
            StatRow(R.string.company_cost to moneyShort(view.cost), R.string.company_value to moneyShort(view.value))
            val gain = view.gain
            StatRow(
                R.string.company_unrealised to if (gain == null) "—" else "${signedMoney(gain)} (${signedPercent(view.gainPercent)})",
                R.string.company_realised to signedMoney(view.realized),
            )
            if (view.cost == null && view.shares > 0) Text(stringResource(R.string.company_cost_unknown), style = MaterialTheme.typography.bodySmall)
        }
    }
}

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

@Composable
private fun HeroCard(
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
            view.hiddenQuoteDate?.let { Text(stringResource(R.string.company_price_hidden, shortDate(it)), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
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
                AreaChart(
                    series = listOf(ChartSeries(series.points, if (rising) SlabColors.gain else SlabColors.loss, fill = true)),
                    description = stringResource(R.string.company_chart_description, spoken),
                    height = CHART_HEIGHT,
                    onSlab = true,
                    xLabel = timeLabel(ui.range),
                    scrubDetail = { _, ys -> ys.firstOrNull()?.let(::money).orEmpty() },
                    references = view.average?.takeIf { view.shares > 0 }?.let { listOf(ChartReference(it, stringResource(R.string.company_avg_tag), BrandColors.sky)) }.orEmpty(),
                )
            }
        }
        val ranges = HistoryRange.entries.toList()
        val labels = ranges.associateWith { stringResource(rangeShort(it)) }
        SegmentedControl(ranges, ui.range, label = { labels.getValue(it) }, onSelect = viewModel::setRange, onSlab = true)
        TextButton(onClick = onSetPrice) { Text(stringResource(R.string.company_set_price), color = BrandColors.sky) }
    }
}

private val CHART_HEIGHT = 170.dp

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
        HistoryRange.YEAR -> R.string.range_year
        HistoryRange.YEARS3 -> R.string.range_3y
        HistoryRange.YEARS5 -> R.string.range_5y
    }

private fun rangeSpoken(range: HistoryRange) =
    when (range) {
        HistoryRange.DAY -> R.string.range_day_spoken
        HistoryRange.WEEK -> R.string.range_week_spoken
        HistoryRange.MONTH -> R.string.range_month_spoken
        HistoryRange.YEAR -> R.string.range_year_spoken
        HistoryRange.YEARS3 -> R.string.range_3y_spoken
        HistoryRange.YEARS5 -> R.string.range_5y_spoken
    }
