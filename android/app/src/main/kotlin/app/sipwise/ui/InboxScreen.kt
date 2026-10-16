package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.Spacing
import app.sipwise.model.InboxFilter
import app.sipwise.model.InboxItem

/** The bell in the app bar, with the number of unread alerts. */
@Composable
fun InboxBell(
    unread: Int,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick) {
        BadgedBox(badge = { if (unread > 0) Badge { Text(unread.toString()) } }) {
            Icon(Icons.Outlined.Notifications, contentDescription = stringResource(R.string.inbox_open_bell))
        }
    }
}

@Composable
fun InboxScreen(
    viewModel: InboxViewModel,
    onOpenCompany: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item { FilterRow(ui, viewModel) }
        ui.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        if (ui.items.isNotEmpty()) item { BulkRow(ui, viewModel) }
        if (ui.items.isEmpty()) item { Empty(ui.filter) }
        items(ui.items, key = { it.id }) { Notification(it, ui.busy, viewModel, onOpenCompany) }
    }
    if (ui.confirmDelete) {
        AlertDialog(
            onDismissRequest = { viewModel.confirmDelete(false) },
            title = { Text(stringResource(R.string.inbox_delete_title)) },
            text = { Text(pluralStringResource(R.plurals.inbox_delete_body, ui.counts.cleared, ui.counts.cleared)) },
            confirmButton = { TextButton(onClick = viewModel::deleteCleared) { Text(stringResource(R.string.inbox_delete)) } },
            dismissButton = { TextButton(onClick = { viewModel.confirmDelete(false) }) { Text(stringResource(R.string.inbox_keep)) } },
        )
    }
}

private fun filterLabel(filter: InboxFilter) =
    when (filter) {
        InboxFilter.INBOX -> R.string.inbox_filter_inbox
        InboxFilter.UNREAD -> R.string.inbox_filter_unread
        InboxFilter.CLEARED -> R.string.inbox_filter_cleared
        InboxFilter.ALL -> R.string.inbox_filter_all
    }

@Composable
private fun FilterRow(
    ui: InboxUi,
    viewModel: InboxViewModel,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items(InboxFilter.entries) { filter ->
            val count = ui.counts.of(filter)
            val label = stringResource(filterLabel(filter))
            FilterChip(
                selected = ui.filter == filter,
                onClick = { viewModel.setFilter(filter) },
                label = { Text(if (count > 0) stringResource(R.string.inbox_filter_count, label, count) else label) },
            )
        }
    }
}

@Composable
private fun BulkRow(
    ui: InboxUi,
    viewModel: InboxViewModel,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (ui.counts.unread > 0) stringResource(R.string.inbox_new, ui.counts.unread) else stringResource(R.string.inbox_nothing_new),
            style = MaterialTheme.typography.bodySmall,
        )
        Row {
            if (ui.counts.unread > 0) TextButton(onClick = viewModel::markAll, enabled = !ui.busy) { Text(stringResource(R.string.inbox_mark_all)) }
            if (ui.filter == InboxFilter.CLEARED) {
                if (ui.counts.cleared > 0) TextButton(onClick = { viewModel.confirmDelete(true) }, enabled = !ui.busy) { Text(stringResource(R.string.inbox_delete_cleared)) }
            } else if (ui.counts.inbox > 0) {
                TextButton(onClick = viewModel::clearAll, enabled = !ui.busy) { Text(stringResource(R.string.inbox_clear_all)) }
            }
        }
    }
}

@Composable
private fun Empty(filter: InboxFilter) {
    val (title, body) =
        when (filter) {
            InboxFilter.INBOX -> R.string.inbox_empty_title to R.string.inbox_empty_inbox
            InboxFilter.UNREAD -> R.string.inbox_empty_title to R.string.inbox_empty_unread
            InboxFilter.CLEARED -> R.string.inbox_empty_cleared_title to R.string.inbox_empty_cleared
            InboxFilter.ALL -> R.string.inbox_empty_all_title to R.string.inbox_empty_all
        }
    EmptyState(stringResource(title), stringResource(body))
}

@Composable
private fun Notification(
    item: InboxItem,
    busy: Boolean,
    viewModel: InboxViewModel,
    onOpenCompany: (String) -> Unit,
) {
    val colors = if (item.unread) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer) else CardDefaults.cardColors()
    SipwiseCard(Modifier.fillMaxWidth(), colors = colors) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(item.title, style = MaterialTheme.typography.titleSmall)
            if (item.body.isNotEmpty()) Text(item.body, style = MaterialTheme.typography.bodyMedium, maxLines = BODY_LINES)
            val meta = listOfNotNull(item.at.take(DATE_CHARS).replace('T', ' '), item.from, if (item.cleared) stringResource(R.string.inbox_cleared) else null)
            Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            Row {
                val ticker = item.ticker
                if (ticker != null && item.canOpen) {
                    TextButton(onClick = { onOpenCompany(ticker) }) {
                        Text(stringResource(if (item.expected) R.string.inbox_mark_received else R.string.inbox_open, ticker))
                    }
                }
                if (item.cleared) {
                    TextButton(onClick = { viewModel.restore(item) }, enabled = !busy) { Text(stringResource(R.string.inbox_restore)) }
                } else {
                    TextButton(onClick = { viewModel.toggleRead(item) }, enabled = !busy) {
                        Text(stringResource(if (item.read) R.string.inbox_mark_unread else R.string.inbox_mark_read))
                    }
                    TextButton(onClick = { viewModel.clear(item) }, enabled = !busy) { Text(stringResource(R.string.inbox_clear)) }
                }
            }
        }
    }
}

private const val BODY_LINES = 5
private const val DATE_CHARS = 16
