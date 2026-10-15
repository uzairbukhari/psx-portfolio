package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.PickRow
import app.sipwise.model.PicksProgress
import app.sipwise.model.PicksStep
import app.sipwise.model.PicksView
import app.sipwise.model.money
import app.sipwise.model.monthTitle

@Composable
fun PicksScreen(
    viewModel: PicksViewModel,
    onRecordOne: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    val readOnly = view.readOnly
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item { Text(stringResource(R.string.picks_experimental), style = MaterialTheme.typography.bodySmall) }
        item { Text(stringResource(R.string.picks_how), style = MaterialTheme.typography.bodySmall) }
        if (readOnly) item { Text(stringResource(R.string.picks_read_only, monthTitle(view.month)), color = MaterialTheme.colorScheme.tertiary) }
        ui.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        item { InputsCard(view, ui, viewModel, readOnly) }
        ui.progress?.let { item { ProgressCard(it) } }
        val run = view.run
        if (run != null && !run.completed) {
            item { Text(run.error ?: stringResource(R.string.picks_failed), color = MaterialTheme.colorScheme.error) }
        }
        if (run != null && run.completed) {
            items(run.sizing) { Text(it, style = MaterialTheme.typography.bodySmall) }
            item { Text(run.fallbackReason ?: stringResource(R.string.picks_quant_note), style = MaterialTheme.typography.bodySmall) }
            item { OutlookCard(run.marketOutlook) }
            view.estimateError?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
            item { Text(stringResource(R.string.picks_top), style = MaterialTheme.typography.titleMedium) }
            if (view.picks.any { it.recordable } && !readOnly) {
                item {
                    Button(onClick = { viewModel.confirm(true) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.picks_record_all)) }
                }
            }
            items(view.picks, key = { it.ticker }) { PickCard(it, readOnly, onRecordOne) }
            if (run.unallocatedPct > 0) item { Text(stringResource(R.string.picks_unallocated, run.unallocatedPct.toInt()), style = MaterialTheme.typography.bodySmall) }
        }
    }
    if (ui.confirming) ConfirmDialog(view, ui, viewModel)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InputsCard(
    view: PicksView,
    ui: PicksUi,
    viewModel: PicksViewModel,
    readOnly: Boolean,
) {
    val selected = ui.selected
    val shown = view.companies.filter { ui.query.isBlank() || it.ticker.contains(ui.query.trim(), true) || it.name.contains(ui.query.trim(), true) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.picks_companies, selected.size, view.max), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.picks_counts, view.counts.saved, view.counts.held, view.counts.shortlisted), style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = ui.query,
                onValueChange = viewModel::setQuery,
                label = { Text(stringResource(R.string.picks_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                if (view.targeted.isNotEmpty()) AssistChip(onClick = viewModel::useTargets, label = { Text(stringResource(R.string.picks_use_targets)) })
                AssistChip(onClick = viewModel::clear, label = { Text(stringResource(R.string.picks_clear)) })
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                for (company in shown) {
                    FilterChip(selected = company.ticker in selected, onClick = { viewModel.toggle(company.ticker) }, label = { Text(company.ticker) })
                }
            }
            if (shown.isEmpty()) Text(stringResource(R.string.picks_no_match), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.picks_saved_note), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedTextField(
                    value = ui.amountText,
                    onValueChange = viewModel::setAmount,
                    label = { Text(stringResource(R.string.picks_amount)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = ui.fee,
                    onValueChange = viewModel::setFee,
                    label = { Text(stringResource(R.string.plan_fee)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
            }
            Text(stringResource(R.string.picks_method), style = MaterialTheme.typography.bodySmall)
            Button(onClick = viewModel::start, enabled = ui.progress == null && !readOnly, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (view.run?.completed == true) R.string.picks_update else R.string.picks_get))
            }
        }
    }
}

@Composable
private fun ProgressCard(progress: PicksProgress) {
    val label =
        when (progress.step) {
            PicksStep.VALIDATING -> R.string.picks_step_validating
            PicksStep.GATHERING -> R.string.picks_step_gathering
            PicksStep.METRICS -> R.string.picks_step_metrics
            PicksStep.ALLOCATING -> R.string.picks_step_allocating
            PicksStep.SAVED -> R.string.picks_step_saved
        }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.picks_progress, stringResource(label), progress.percent), style = MaterialTheme.typography.titleSmall)
            LinearProgressIndicator(progress = { progress.percent / PERCENT_FULL }, modifier = Modifier.fillMaxWidth())
            if (progress.total > 0) Text(pluralStringResource(R.plurals.picks_gathered, progress.completed, progress.completed, progress.total), style = MaterialTheme.typography.bodySmall)
            if (progress.pending.isNotEmpty()) Text(stringResource(R.string.picks_waiting, progress.pending.joinToString(", ")), style = MaterialTheme.typography.bodySmall)
            if (progress.degraded) Text(stringResource(R.string.picks_partial), style = MaterialTheme.typography.bodySmall)
        }
    }
}

private const val PERCENT_FULL = 100f

@Composable
private fun OutlookCard(text: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(stringResource(R.string.picks_outlook), style = MaterialTheme.typography.titleSmall)
            Text(text)
        }
    }
}

@Composable
private fun PickCard(
    row: PickRow,
    readOnly: Boolean,
    onRecordOne: (String) -> Unit,
) {
    val links = LocalUriHandler.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.picks_row_title, row.ticker, row.allocationPct.toInt()), style = MaterialTheme.typography.titleMedium)
                    Text(row.name, style = MaterialTheme.typography.bodySmall)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(money(row.allocationPkr), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.picks_confidence, row.confidence), style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(row.thesis)
            if (row.evidence.isNotEmpty()) {
                Text(stringResource(R.string.picks_evidence, row.evidence.joinToString(" · ") { "${it.label} ${it.value}" }), style = MaterialTheme.typography.bodySmall)
            }
            if (row.risks.isNotEmpty()) Text(stringResource(R.string.picks_risks, row.risks.joinToString("; ")), style = MaterialTheme.typography.bodySmall)
            for (source in row.sources) {
                TextButton(onClick = { links.openUri(source.url) }) {
                    Text(if (source.date.isEmpty()) source.title else "${source.title} · ${source.date}")
                }
            }
            if (row.price != null && row.shares != null) {
                Text(pluralStringResource(R.plurals.picks_estimate, row.shares.toInt(), row.shares.toInt(), money(row.price), money(row.estimatedSpend ?: 0.0)), style = MaterialTheme.typography.bodySmall)
                if (row.recordable && !readOnly) TextButton(onClick = { onRecordOne(row.ticker) }) { Text(stringResource(R.string.picks_record_one)) }
            } else {
                Text(stringResource(R.string.picks_no_price), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ConfirmDialog(
    view: PicksView,
    ui: PicksUi,
    viewModel: PicksViewModel,
) {
    val rows = view.picks.filter { it.recordable }
    AlertDialog(
        onDismissRequest = { viewModel.confirm(false) },
        title = { Text(stringResource(R.string.picks_confirm_title)) },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                item { Text(stringResource(R.string.picks_confirm_note, monthTitle(view.month)), style = MaterialTheme.typography.bodySmall) }
                items(rows, key = { it.ticker }) {
                    val count = (it.shares ?: 0.0).toInt()
                    Text(pluralStringResource(R.plurals.picks_confirm_row, count, it.ticker, count, money(it.price ?: 0.0)))
                }
                item { Text(stringResource(R.string.picks_confirm_total, money(rows.sumOf { it.estimatedSpend ?: 0.0 })), style = MaterialTheme.typography.titleSmall) }
                ui.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
            }
        },
        confirmButton = {
            Button(onClick = viewModel::recordAll, enabled = !ui.busy && rows.isNotEmpty()) {
                Text(pluralStringResource(R.plurals.plan_record_buys, rows.size, rows.size))
            }
        },
        dismissButton = { TextButton(onClick = { viewModel.confirm(false) }) { Text(stringResource(R.string.entry_cancel)) } },
    )
}
