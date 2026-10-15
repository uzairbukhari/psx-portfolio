package app.sipwise.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.ActivityFilter
import app.sipwise.model.money
import app.sipwise.model.shortDate

@Composable
fun ActivityScreen(
    viewModel: ActivityViewModel,
    onOpenEntry: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        OutlinedTextField(
            value = ui.query,
            onValueChange = viewModel::setQuery,
            label = { Text(stringResource(R.string.activity_search)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(ActivityFilter.entries) { filter ->
                FilterChip(
                    selected = filter == ui.filter,
                    onClick = { viewModel.setFilter(filter) },
                    label = { Text(stringResource(filterLabel(filter))) },
                )
            }
        }
        val view = ui.view
        if (view == null) {
            if (ui.error != null) Text(ui.error.orEmpty()) else LoadingScreen()
        } else if (view.count == 0) {
            Text(stringResource(R.string.activity_empty), style = MaterialTheme.typography.bodyLarge)
        } else {
            LazyColumn(contentPadding = PaddingValues(bottom = Spacing.xl)) {
                for (section in view.sections) {
                    item(key = "h-${section.key}") {
                        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxWidth()) {
                            Text(section.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(vertical = Spacing.sm))
                        }
                    }
                    items(section.data, key = { it.id }) { entry ->
                        ListItem(
                            overlineContent = { Text(shortDate(entry.date)) },
                            headlineContent = { Text("${entry.ticker} · ${entry.title}") },
                            supportingContent = { Text(entry.detail) },
                            trailingContent = { entry.amount?.let { Text(money(it)) } },
                            modifier = if (entry.editable) Modifier.clickable { onOpenEntry(entry.id) } else Modifier,
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

private fun filterLabel(filter: ActivityFilter) =
    when (filter) {
        ActivityFilter.ALL -> R.string.filter_all
        ActivityFilter.BUY -> R.string.filter_buy
        ActivityFilter.SELL -> R.string.filter_sell
        ActivityFilter.DIVIDEND -> R.string.filter_dividend
        ActivityFilter.SPLIT -> R.string.filter_split
    }
