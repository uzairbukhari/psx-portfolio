package app.sipwise.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.ListRow
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.TickerTile
import app.sipwise.model.ActivityFilter
import app.sipwise.model.money
import app.sipwise.model.shortDate

@OptIn(ExperimentalFoundationApi::class)
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
            if (ui.error != null) Text(ui.error.orEmpty()) else ScreenSkeleton()
        } else if (view.count == 0) {
            EmptyState(stringResource(R.string.nav_activity), stringResource(R.string.activity_empty))
        } else {
            LazyColumn(contentPadding = PaddingValues(bottom = Spacing.xl)) {
                for (section in view.sections) {
                    stickyHeader(key = "h-${section.key}") {
                        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxWidth()) {
                            Text(section.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(vertical = Spacing.sm))
                        }
                    }
                    items(section.data, key = { it.id }) { entry ->
                        SipwiseCard(Modifier.fillMaxWidth().padding(bottom = Spacing.sm)) {
                            ListRow(
                                title = "${entry.ticker} · ${entry.title}",
                                subtitle = "${shortDate(entry.date)} · ${entry.detail}",
                                onClick = if (entry.editable) ({ onOpenEntry(entry.id) }) else null,
                                modifier = Modifier.padding(horizontal = Spacing.lg),
                                leading = { TickerTile(entry.ticker) },
                                trailing = {
                                    entry.amount?.let {
                                        MoneyText(money(it), style = SipwiseNumbers.small, color = if (entry.kind == "dividend") SipwiseTheme.colors.gain else Color.Unspecified)
                                    }
                                },
                            )
                        }
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
