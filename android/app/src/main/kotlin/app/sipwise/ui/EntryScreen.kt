package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.EntryKind
import app.sipwise.model.money
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@Composable
fun EntryScreen(
    viewModel: EntryViewModel,
    onDone: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(ui.saved) { if (ui.saved) onDone() }
    val options = ui.options
    if (options == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    val form = ui.form
    if (ui.missing) {
        Text(stringResource(R.string.entry_missing), modifier = Modifier.padding(Spacing.gutter))
        return
    }
    ui.readOnly?.let {
        Text(it, modifier = Modifier.padding(Spacing.gutter))
        return
    }
    val portfolio = options.portfolios.firstOrNull { it.id == form.portfolioId }
    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (ui.editing) Text(stringResource(R.string.entry_edit_title), style = MaterialTheme.typography.titleLarge)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(EntryKind.entries) { kind ->
                FilterChip(
                    selected = kind == form.kind,
                    enabled = !ui.editing,
                    onClick = { viewModel.update(form.copy(kind = kind)) },
                    label = { Text(stringResource(kindLabel(kind))) },
                )
            }
        }
        val writable = options.portfolios.filter { !it.locked }
        if (writable.size > 1 && !ui.editing) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                items(writable) { p ->
                    FilterChip(
                        selected = p.id == form.portfolioId,
                        onClick = { viewModel.update(form.copy(portfolioId = p.id, ticker = "")) },
                        label = { Text(p.name) },
                    )
                }
            }
        }
        CompanyField(
            portfolio?.companies.orEmpty().map { it.ticker to it.name },
            if (form.newCompany) stringResource(R.string.entry_new_company) else form.ticker,
            enabled = !ui.editing,
            allowNew = !ui.editing,
            onNew = { viewModel.update(form.copy(newCompany = true, ticker = "")) },
        ) { viewModel.update(form.copy(newCompany = false, ticker = it)) }
        if (form.newCompany) {
            OutlinedTextField(
                value = form.symbol,
                onValueChange = { viewModel.update(form.copy(symbol = it.uppercase())) },
                label = { Text(stringResource(R.string.entry_symbol)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = form.companyName,
                onValueChange = { viewModel.update(form.copy(companyName = it)) },
                label = { Text(stringResource(R.string.entry_company_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                items(options.sectors) { sector ->
                    FilterChip(selected = sector == form.sector, onClick = { viewModel.update(form.copy(sector = sector)) }, label = { Text(sector) })
                }
            }
            Text(stringResource(R.string.entry_new_company_hint), style = MaterialTheme.typography.bodySmall)
        }
        DateField(stringResource(R.string.entry_date), form.date) { viewModel.update(form.copy(date = it)) }
        when (form.kind) {
            EntryKind.DIVIDEND ->
                NumberField(R.string.entry_per_share, form.perShare) { viewModel.update(form.copy(perShare = it)) }
            EntryKind.SPLIT -> {
                NumberField(R.string.entry_old_shares, form.oldShares) { viewModel.update(form.copy(oldShares = it)) }
                NumberField(R.string.entry_new_shares, form.newShares) { viewModel.update(form.copy(newShares = it)) }
            }
            else -> {
                NumberField(R.string.entry_shares, form.shares) { viewModel.update(form.copy(shares = it)) }
                NumberField(R.string.entry_price, form.price) { viewModel.update(form.copy(price = it)) }
                NumberField(R.string.entry_fees, form.fees) { viewModel.update(form.copy(fees = it)) }
                if (form.kind == EntryKind.BUY) {
                    MonthPickerField(stringResource(R.string.month_picker_label), form.month, !ui.busy) { viewModel.update(form.copy(month = it)) }
                }
                ui.totals?.let { totals ->
                    Text(totals.label, style = MaterialTheme.typography.labelLarge)
                    Text(money(totals.total), style = MaterialTheme.typography.titleLarge)
                }
            }
        }
        OutlinedTextField(
            value = form.note,
            onValueChange = { viewModel.update(form.copy(note = it)) },
            label = { Text(stringResource(R.string.entry_note)) },
            modifier = Modifier.fillMaxWidth(),
        )
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = viewModel::submit, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.entry_save))
        }
        if (ui.editing) {
            OutlinedButton(onClick = { viewModel.askVoid(true) }, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.entry_void))
            }
        }
    }
    if (ui.confirmVoid) {
        AlertDialog(
            onDismissRequest = { viewModel.askVoid(false) },
            title = { Text(stringResource(R.string.entry_void_title)) },
            text = { Text(stringResource(R.string.entry_void_body)) },
            confirmButton = { Button(onClick = viewModel::confirmVoid) { Text(stringResource(R.string.entry_void_confirm)) } },
            dismissButton = { TextButton(onClick = { viewModel.askVoid(false) }) { Text(stringResource(R.string.entry_cancel)) } },
        )
    }
}

@Composable
private fun CompanyField(
    companies: List<Pair<String, String>>,
    selected: String,
    enabled: Boolean,
    allowNew: Boolean,
    onNew: () -> Unit,
    onSelect: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Text(selected.ifEmpty { stringResource(R.string.entry_company) })
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((ticker, name) in companies) {
                DropdownMenuItem(
                    text = { Text("$ticker · $name") },
                    onClick = {
                        onSelect(ticker)
                        open = false
                    },
                )
            }
            if (allowNew) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.entry_new_company_option)) },
                    onClick = {
                        onNew()
                        open = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        trailingIcon = { TextButton(onClick = { open = true }) { Text(stringResource(R.string.entry_pick_date)) } },
        modifier = Modifier.fillMaxWidth(),
    )
    if (open) {
        val initial = runCatching { LocalDate.parse(value).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                        open = false
                    },
                ) { Text(stringResource(R.string.entry_date_ok)) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.entry_cancel)) } },
        ) { DatePicker(state = state) }
    }
}

@Composable
private fun NumberField(
    label: Int,
    value: String,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(stringResource(label)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun kindLabel(kind: EntryKind) =
    when (kind) {
        EntryKind.BUY -> R.string.entry_kind_buy
        EntryKind.SELL -> R.string.entry_kind_sell
        EntryKind.OPENING -> R.string.entry_kind_opening
        EntryKind.DIVIDEND -> R.string.entry_kind_dividend
        EntryKind.SPLIT -> R.string.entry_kind_split
    }
