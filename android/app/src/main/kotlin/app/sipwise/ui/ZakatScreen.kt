package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StatTile
import app.sipwise.designsystem.ValueRow
import app.sipwise.model.ZakatView
import app.sipwise.model.mediumDate
import app.sipwise.model.money
import app.sipwise.model.moneyShort

private enum class ZakatDialog { Pay, Item, Close, Stop }

@Composable
fun ZakatScreen(viewModel: ZakatViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (view == null) {
            Text(stringResource(R.string.zakat_loading))
        } else if (view.setup) {
            Setup(view, ui.busy, viewModel)
        } else {
            Overview(view, ui.busy, viewModel)
        }
    }
}

@Composable
private fun Setup(
    view: ZakatView,
    busy: Boolean,
    viewModel: ZakatViewModel,
) {
    var date by remember { mutableStateOf(view.asOf) }
    var school by remember { mutableStateOf("hanafi") }
    var shares by remember { mutableStateOf("market") }
    Text(stringResource(R.string.zakat_intro), style = MaterialTheme.typography.bodyMedium)
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedTextField(
                value = date,
                onValueChange = { date = it },
                label = { Text(stringResource(R.string.zakat_date)) },
                supportingText = { Text(stringResource(R.string.zakat_date_hint, view.hijri)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Overline(stringResource(R.string.zakat_school))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                listOf("hanafi" to R.string.zakat_school_hanafi, "shafii" to R.string.zakat_school_other).forEach { (key, label) ->
                    FilterChip(selected = school == key, onClick = { school = key }, label = { Text(stringResource(label)) })
                }
            }
            Overline(stringResource(R.string.zakat_shares))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FilterChip(selected = shares == "market", onClick = { shares = "market" }, label = { Text(stringResource(R.string.zakat_shares_market)) })
                FilterChip(selected = shares == "proxy25", onClick = { shares = "proxy25" }, label = { Text(stringResource(R.string.zakat_shares_proxy)) })
            }
            Button(onClick = { viewModel.setup(date.trim(), school, shares) }, enabled = !busy && view.canLog, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.zakat_start))
            }
        }
    }
}

@Composable
private fun Overview(
    view: ZakatView,
    busy: Boolean,
    viewModel: ZakatViewModel,
) {
    var dialog by remember { mutableStateOf<ZakatDialog?>(null) }
    val p = view.progress
    NightSlab(Modifier.fillMaxWidth()) {
        Overline(stringResource(R.string.zakat_year, p.name), color = SlabColors.muted)
        MoneyText(moneyShort(p.estimate), color = SlabColors.ink)
        Text(stringResource(R.string.zakat_due, mediumDate(view.dueDate), view.dueHijri, pluralStringResource(R.plurals.zakat_days_left, p.daysLeft, p.daysLeft)), color = SlabColors.muted)
        LinearProgressIndicator(progress = { (p.percentPaid / PERCENT).toFloat() }, modifier = Modifier.fillMaxWidth())
        Text(stringResource(R.string.zakat_paid_line, moneyShort(p.paid), moneyShort(p.remaining)), color = SlabColors.ink)
    }
    if (!view.breakdown.aboveNisab) Text(stringResource(R.string.zakat_below_nisab, moneyShort(view.breakdown.nisab.value)), style = MaterialTheme.typography.bodyMedium)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        StatTile(stringResource(R.string.zakat_paid), moneyShort(p.paid), Modifier.weight(1f))
        StatTile(stringResource(R.string.zakat_left), moneyShort(p.remaining), Modifier.weight(1f))
    }
    Button(onClick = { dialog = ZakatDialog.Pay }, enabled = !busy && view.canLog, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.zakat_log_payment))
    }
    if (p.closeDue) {
        OutlinedButton(onClick = { dialog = ZakatDialog.Close }, enabled = !busy && view.canLog, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.zakat_close_year))
        }
    }
    BreakdownCard(view)
    ItemsCard(view, busy, onAdd = { dialog = ZakatDialog.Item }, onRemove = viewModel::removeItem)
    PaymentsCard(view, busy, viewModel::voidPayment)
    RemindersCard(view)
    Text(stringResource(R.string.zakat_note), style = MaterialTheme.typography.bodySmall)
    TextButton(onClick = { dialog = ZakatDialog.Stop }, enabled = !busy && view.canLog) { Text(stringResource(R.string.zakat_stop)) }

    when (dialog) {
        ZakatDialog.Pay ->
            PayDialog(view, { dialog = null }) { amount, date, kind, note ->
                viewModel.pay(amount, date, kind, note)
                dialog = null
            }
        ZakatDialog.Item ->
            ItemDialog(view, { dialog = null }) { kind, amount, note ->
                viewModel.addItem(kind, amount, note)
                dialog = null
            }
        ZakatDialog.Close ->
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text(stringResource(R.string.zakat_close_year)) },
                text = { Text(stringResource(R.string.zakat_close_body, money(p.estimate))) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.closeYear(false)
                            dialog = null
                        },
                    ) { Text(stringResource(R.string.zakat_close_confirm)) }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text(stringResource(R.string.zakat_cancel)) } },
            )
        ZakatDialog.Stop ->
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text(stringResource(R.string.zakat_stop)) },
                text = { Text(stringResource(R.string.zakat_stop_body)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.stop()
                            dialog = null
                        },
                    ) { Text(stringResource(R.string.zakat_stop_confirm)) }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text(stringResource(R.string.zakat_cancel)) } },
            )
        null -> Unit
    }
}

@Composable
private fun BreakdownCard(view: ZakatView) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(R.string.zakat_counted))
            view.breakdown.rows.forEach { ValueRow(it.label, money(it.counted)) }
            HorizontalDivider()
            ValueRow(stringResource(R.string.zakat_debts), money(-view.breakdown.debts))
            ValueRow(stringResource(R.string.zakat_net), money(view.breakdown.net))
            ValueRow(stringResource(R.string.zakat_nisab), money(view.breakdown.nisab.value))
            view.breakdown.otherMethodZakat?.let { ValueRow(stringResource(R.string.zakat_other_method), money(it)) }
            view.breakdown.missing.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun ItemsCard(
    view: ZakatView,
    busy: Boolean,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Overline(stringResource(R.string.zakat_cash_and_more))
                TextButton(onClick = onAdd, enabled = !busy && view.canLog) { Text(stringResource(R.string.zakat_add)) }
            }
            if (view.items.isEmpty()) Text(stringResource(R.string.zakat_no_items), style = MaterialTheme.typography.bodySmall)
            view.items.forEach { item ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ValueRow(item.label, money(item.amount), Modifier.weight(1f))
                    TextButton(onClick = { onRemove(item.id) }, enabled = !busy && view.canLog) { Text(stringResource(R.string.zakat_remove)) }
                }
            }
        }
    }
}

@Composable
private fun PaymentsCard(
    view: ZakatView,
    busy: Boolean,
    onVoid: (String) -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(R.string.zakat_payments))
            if (view.payments.isEmpty()) Text(stringResource(R.string.zakat_no_payments), style = MaterialTheme.typography.bodySmall)
            view.payments.reversed().forEach { pay ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ValueRow("${mediumDate(pay.date)} · ${pay.kind}", money(pay.amount), Modifier.weight(1f))
                    TextButton(onClick = { onVoid(pay.id) }, enabled = !busy && view.canLog) { Text(stringResource(R.string.zakat_void)) }
                }
            }
            view.progress.past.forEach { y -> ValueRow(stringResource(R.string.zakat_past_year, y.name), "${money(y.paid)} / ${money(y.amountDue)}") }
        }
    }
}

@Composable
private fun RemindersCard(view: ZakatView) {
    if (view.reminders.isNotEmpty()) {
        SipwiseCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Overline(stringResource(R.string.zakat_coming_up))
                view.reminders.forEach { Text("${mediumDate(it.date)} · ${it.title}", style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }
}

@Composable
private fun PayDialog(
    view: ZakatView,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String) -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(view.asOf) }
    var kind by remember { mutableStateOf("direct") }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.zakat_log_payment)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedTextField(amount, { amount = it }, label = { Text(stringResource(R.string.zakat_amount)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(date, { date = it }, label = { Text(stringResource(R.string.zakat_paid_on)) }, singleLine = true)
                view.kinds.payment.chunked(PAY_CHIPS).forEach { chunk ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        chunk.forEach { k -> FilterChip(selected = kind == k, onClick = { kind = k }, label = { Text(k) }) }
                    }
                }
                OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.zakat_note_field)) }, singleLine = true)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(amount, date.trim(), kind, note) }) { Text(stringResource(R.string.zakat_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.zakat_cancel)) } },
    )
}

@Composable
private fun ItemDialog(
    view: ZakatView,
    onDismiss: () -> Unit,
    onSave: (String, String, String) -> Unit,
) {
    var kind by remember { mutableStateOf(view.kinds.manual.firstOrNull()?.key.orEmpty()) }
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.zakat_add)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                view.kinds.manual.forEach { k -> FilterChip(selected = kind == k.key, onClick = { kind = k.key }, label = { Text(k.label) }) }
                OutlinedTextField(amount, { amount = it }, label = { Text(stringResource(R.string.zakat_amount)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.zakat_note_field)) }, singleLine = true)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(kind, amount, note) }) { Text(stringResource(R.string.zakat_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.zakat_cancel)) } },
    )
}

private const val PERCENT = 100.0
private const val PAY_CHIPS = 3
