package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.ScopePortfolio

@Composable
fun PortfoliosScreen(viewModel: PortfoliosViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<ScopePortfolio?>(null) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Text(stringResource(R.string.portfolios_hint), style = MaterialTheme.typography.bodyMedium)
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        ui.portfolios.forEach { item -> PortfolioCard(item, ui.busy, viewModel, onDelete = { confirm = item }) }
        OutlinedTextField(
            value = ui.name,
            onValueChange = viewModel::setName,
            label = { Text(stringResource(if (ui.editing != null) R.string.portfolios_new_name else R.string.portfolios_create)) },
            placeholder = { Text(stringResource(R.string.portfolios_placeholder)) },
            enabled = !ui.busy,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = viewModel::save, enabled = ui.name.isNotBlank() && !ui.busy, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (ui.editing != null) R.string.portfolios_save_name else R.string.portfolios_create))
        }
        if (ui.editing != null) TextButton(onClick = viewModel::cancelRename) { Text(stringResource(R.string.portfolios_cancel_rename)) }
    }
    confirm?.let { item ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(R.string.portfolios_delete_title)) },
            text = { Text(item.name) },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.delete(item)
                        confirm = null
                    },
                ) { Text(stringResource(R.string.portfolios_delete)) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.entry_cancel)) } },
        )
    }
}

@Composable
private fun PortfolioCard(
    item: ScopePortfolio,
    busy: Boolean,
    viewModel: PortfoliosViewModel,
    onDelete: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(item.name, style = MaterialTheme.typography.titleMedium)
                    Text(item.contents, style = MaterialTheme.typography.bodySmall)
                }
                Text(stringResource(if (item.locked) R.string.portfolios_locked else R.string.portfolios_open), style = MaterialTheme.typography.labelMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                TextButton(onClick = { viewModel.startRename(item) }, enabled = !busy) { Text(stringResource(R.string.portfolios_rename)) }
                TextButton(onClick = { viewModel.toggleLock(item) }, enabled = !busy) {
                    Text(stringResource(if (item.locked) R.string.portfolios_unlock else R.string.portfolios_lock))
                }
                if (item.canDelete) TextButton(onClick = onDelete, enabled = !busy) { Text(stringResource(R.string.portfolios_delete)) }
            }
        }
    }
}
