package app.sipwise.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.ActivityEntry
import app.sipwise.model.CompanyView
import app.sipwise.model.DividendRow
import app.sipwise.model.HistoryRange
import app.sipwise.model.HistorySeries
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun CompanyScreen(viewModel: CompanyViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
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
            Text(view.name, style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.company_subtitle, view.ticker, view.sector), style = MaterialTheme.typography.bodyMedium)
        }
        item { PriceCard(view, onSetPrice = { viewModel.open(CompanyDialog.Price) }) }
        item { PositionCard(view) }
        item { ChartCard(ui, viewModel) }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                item {
                    FilterChip(
                        selected = ui.tab == CompanyTab.LEDGER,
                        onClick = { viewModel.setTab(CompanyTab.LEDGER) },
                        label = { Text(stringResource(R.string.company_tab_ledger)) },
                    )
                }
                item {
                    val expected = view.dividends.count { it.expected }
                    FilterChip(
                        selected = ui.tab == CompanyTab.DIVIDENDS,
                        onClick = { viewModel.setTab(CompanyTab.DIVIDENDS) },
                        label = {
                            Text(
                                if (expected > 0) {
                                    stringResource(R.string.company_tab_dividends_expected, expected)
                                } else {
                                    stringResource(R.string.company_tab_dividends)
                                },
                            )
                        },
                    )
                }
            }
        }
        if (ui.tab == CompanyTab.DIVIDENDS) {
            if (view.dividends.isEmpty()) item { Text(stringResource(R.string.company_no_dividends)) }
            items(view.dividends, key = { it.id }) { DividendItem(it, onReceive = { viewModel.open(CompanyDialog.Received(it)) }) }
        } else {
            if (view.entries.isEmpty()) item { Text(stringResource(R.string.company_no_entries, view.ticker)) }
            items(view.entries, key = { it.id }) { EntryItem(it, onVoid = { viewModel.open(CompanyDialog.Void(it)) }) }
        }
    }
    when (val dialog = ui.dialog) {
        null -> Unit
        CompanyDialog.Price -> PriceDialog(view, ui.busy, ui.error, onSave = viewModel::savePrice, onDismiss = { viewModel.open(null) })
        is CompanyDialog.Received -> ReceivedDialog(dialog.row, ui.busy, ui.error, onSave = viewModel::markReceived, onDismiss = { viewModel.open(null) })
        is CompanyDialog.Void -> VoidDialog(dialog.entry, ui.busy, ui.error, onConfirm = viewModel::voidEntry, onDismiss = { viewModel.open(null) })
    }
}

@Composable
private fun PriceCard(
    view: CompanyView,
    onSetPrice: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(stringResource(R.string.company_last_price), style = MaterialTheme.typography.labelLarge)
            val price = view.price
            if (price != null) {
                Text(money(price), style = MaterialTheme.typography.headlineMedium)
                val date = shortDate(view.priceDate)
                Text(
                    if (view.priceManual) stringResource(R.string.company_price_manual, date) else stringResource(R.string.company_price_asof, date),
                    style = MaterialTheme.typography.bodySmall,
                )
            } else {
                Text(stringResource(R.string.company_no_price), style = MaterialTheme.typography.titleMedium)
                view.hiddenQuoteDate?.let { Text(stringResource(R.string.company_price_hidden, shortDate(it)), style = MaterialTheme.typography.bodySmall) }
            }
            OutlinedButton(onClick = onSetPrice) { Text(stringResource(R.string.company_set_price)) }
        }
    }
}

@Composable
private fun PositionCard(view: CompanyView) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.company_position), style = MaterialTheme.typography.labelLarge)
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
            Column(Modifier.weight(1f)) {
                Text(stringResource(label), style = MaterialTheme.typography.labelMedium)
                Text(value, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

@Composable
private fun ChartCard(
    ui: CompanyUi,
    viewModel: CompanyViewModel,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.company_price_chart), style = MaterialTheme.typography.labelLarge)
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
                Text(text, style = MaterialTheme.typography.titleSmall)
            }
            when {
                ui.historyLoading -> LoadingBlock()
                ui.historyError != null ->
                    Column {
                        Text(ui.historyError.orEmpty(), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = viewModel::loadHistory) { Text(stringResource(R.string.retry)) }
                    }
                series == null || series.points.size < 2 -> Text(stringResource(R.string.company_no_history))
                else -> LineChart(series, spoken)
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                items(HistoryRange.entries) { range ->
                    FilterChip(
                        selected = range == ui.range,
                        onClick = { viewModel.setRange(range) },
                        label = { Text(stringResource(rangeShort(range))) },
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingBlock() {
    Column(Modifier.fillMaxWidth().height(CHART_HEIGHT)) { LoadingScreen() }
}

private val CHART_HEIGHT = 150.dp

@Composable
private fun LineChart(
    series: HistorySeries,
    spokenRange: String,
) {
    val points = series.points
    val rising = (series.change?.change ?: 0.0) >= 0
    val color: Color = if (rising) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
    val description = stringResource(R.string.company_chart_description, spokenRange)
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(CHART_HEIGHT)
            .semantics { contentDescription = description },
    ) {
        val xs = points.map { it[0] }
        val ys = points.map { it[1] }
        val minX = xs.min()
        val spanX = (xs.max() - minX).takeIf { it > 0 } ?: 1.0
        val minY = ys.min()
        val spanY = (ys.max() - minY).takeIf { it > 0 } ?: 1.0
        val path = Path()
        points.forEachIndexed { i, p ->
            val x = ((p[0] - minX) / spanX * size.width).toFloat()
            val y = size.height - ((p[1] - minY) / spanY * size.height).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = Stroke(width = 2.dp.toPx()))
        drawLine(color.copy(alpha = AXIS_ALPHA), Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1.dp.toPx())
    }
}

private const val AXIS_ALPHA = 0.3f

@Composable
private fun DividendItem(
    row: DividendRow,
    onReceive: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
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
    onVoid: () -> Unit,
) {
    Column {
        ListItem(
            headlineContent = { Text(entry.title) },
            supportingContent = { Text("${shortDate(entry.date)} · ${entry.detail}") },
            trailingContent = { entry.amount?.let { Text(money(it)) } },
            modifier = if (entry.editable) Modifier.clickable(onClick = onVoid) else Modifier,
        )
        HorizontalDivider()
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

@Composable
private fun VoidDialog(
    entry: ActivityEntry,
    busy: Boolean,
    error: String?,
    onConfirm: (ActivityEntry) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.company_void_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(stringResource(R.string.company_void_body, entry.title))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { Button(onClick = { onConfirm(entry) }, enabled = !busy) { Text(stringResource(R.string.company_void)) } },
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
