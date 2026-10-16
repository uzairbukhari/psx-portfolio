package app.sipwise.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.Spacing
import app.sipwise.model.TargetDraft

@Composable
fun TargetsScreen(
    viewModel: TargetsViewModel,
    onDone: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(ui.saved) { if (ui.saved) onDone() }
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    val totals = ui.eval?.totals
    LazyColumn(
        contentPadding = PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        item { Text(stringResource(R.string.targets_intro, view.cap, view.cap, view.cap), style = MaterialTheme.typography.bodyMedium) }
        if (totals != null) {
            item {
                SipwiseCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        Text(stringResource(R.string.targets_total, totals.total.toInt()), style = MaterialTheme.typography.titleMedium)
                        Text(
                            when (totals.status) {
                                "exact" -> stringResource(R.string.targets_ready)
                                "over" -> stringResource(R.string.targets_over, (-totals.remaining).toInt())
                                else -> stringResource(R.string.targets_to_go, totals.remaining.toInt())
                            },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (totals.overCap.isNotEmpty()) {
                            Text(stringResource(R.string.targets_over_cap, totals.overCap.joinToString(", "), view.cap), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
        if (ui.rows.isEmpty()) item { Text(stringResource(R.string.targets_empty)) }
        items(ui.rows, key = { it.ticker }) { row ->
            val name = view.companies.firstOrNull { it.ticker == row.ticker }?.name.orEmpty()
            TargetCard(row, name, ui.eval?.statuses?.get(row.ticker)?.label.orEmpty(), viewModel)
        }
        item { AddCompany(ui, viewModel) }
        if (ui.rows.size >= 2) item { TextButton(onClick = viewModel::spreadEvenly) { Text(stringResource(R.string.targets_spread)) } }
        item { Text(stringResource(R.string.targets_screen_note, view.today), style = MaterialTheme.typography.bodySmall) }
        ui.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        item {
            Button(
                onClick = viewModel::save,
                enabled = !ui.busy && !view.locked && totals?.status == "exact",
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(if (ui.busy) R.string.entry_saving else R.string.targets_save)) }
            if (view.locked) Text(stringResource(R.string.targets_locked), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun TargetCard(
    row: TargetDraft,
    name: String,
    status: String,
    viewModel: TargetsViewModel,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(row.ticker, style = MaterialTheme.typography.titleMedium)
                    Text(name, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                TextButton(onClick = { viewModel.remove(row.ticker) }) { Text(stringResource(R.string.targets_remove)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedButton(onClick = { viewModel.bump(row.ticker, -1) }) { Text(stringResource(R.string.targets_minus)) }
                OutlinedTextField(
                    value = row.weight,
                    onValueChange = { viewModel.patch(row.ticker) { r -> r.copy(weight = it) } },
                    label = { Text(stringResource(R.string.targets_weight)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = { viewModel.bump(row.ticker, 1) }) { Text(stringResource(R.string.targets_plus)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                OutlinedTextField(
                    value = row.screenDate,
                    onValueChange = { viewModel.patch(row.ticker) { r -> r.copy(screenDate = it) } },
                    label = { Text(stringResource(R.string.targets_screen_date)) },
                    supportingText = { Text(stringResource(R.string.targets_screen_hint)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.targets_new_buys), style = MaterialTheme.typography.labelMedium)
                    Switch(checked = row.approved, onCheckedChange = { viewModel.patch(row.ticker) { r -> r.copy(approved = it) } })
                }
            }
            if (status.isNotEmpty()) Text(status, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun AddCompany(
    ui: TargetsUi,
    viewModel: TargetsViewModel,
) {
    if (!ui.adding) {
        OutlinedButton(onClick = { viewModel.openAdd(true) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.targets_add)) }
        return
    }
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedTextField(
                value = ui.query,
                onValueChange = viewModel::search,
                label = { Text(stringResource(R.string.targets_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            val search = ui.search
            search?.items?.forEach { company ->
                ListItem(
                    headlineContent = { Text(company.ticker) },
                    supportingContent = { Text(company.name) },
                    modifier = Modifier.clickable { viewModel.add(company.ticker) },
                )
            }
            if (search != null && search.total == 0) Text(stringResource(R.string.targets_no_match), style = MaterialTheme.typography.bodySmall)
            if (search != null && search.total > search.items.size) {
                Text(pluralStringResource(R.plurals.targets_showing, search.total, search.items.size, search.total), style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = { viewModel.openAdd(false) }) { Text(stringResource(R.string.entry_cancel)) }
        }
    }
}
