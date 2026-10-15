package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.HoldingRow
import app.sipwise.model.HoldingSort
import app.sipwise.model.PortfolioSummary
import app.sipwise.model.moneyShort
import app.sipwise.model.plural
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun HoldingsScreen(
    viewModel: HoldingsViewModel,
    onOpenCompany: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        item { SummaryCard(view.summary) }
        if (view.rows.isEmpty()) item { Text(stringResource(R.string.holdings_empty), style = MaterialTheme.typography.bodyLarge) }
        item { SortRow(ui.sort, viewModel::setSort) }
        if (view.sectors.size > 1) item { SectorRow(view.sectors, ui.sector, viewModel::setSector) }
        items(view.rows, key = { it.ticker }) { HoldingItem(it, onOpenCompany) }
        if (view.soldOut.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        pluralStringResource(R.plurals.holdings_show_sold, view.soldOut.size, view.soldOut.size),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Switch(checked = ui.showSold, onCheckedChange = viewModel::setShowSold)
                }
            }
            if (ui.showSold) items(view.soldOut, key = { "sold-${it.ticker}" }) { HoldingItem(it, onOpenCompany) }
        }
    }
}

@Composable
private fun SummaryCard(summary: PortfolioSummary) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(stringResource(R.string.holdings_value), style = MaterialTheme.typography.labelLarge)
            Text(moneyShort(summary.value), style = MaterialTheme.typography.headlineMedium)
            val gain = summary.gain
            if (gain != null) {
                val color = if (gain >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                Text(
                    "${signedMoney(gain)} (${signedPercent(summary.gainPercent)})",
                    color = color,
                    style = MaterialTheme.typography.titleMedium,
                )
            } else if (summary.incomplete.isNotEmpty()) {
                Text(stringResource(R.string.holdings_incomplete), style = MaterialTheme.typography.bodyMedium)
            }
            Text(plural(summary.heldCount, "holding"), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SortRow(
    selected: HoldingSort,
    onSelect: (HoldingSort) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items(HoldingSort.entries) { sort ->
            FilterChip(
                selected = sort == selected,
                onClick = { onSelect(sort) },
                label = { Text(stringResource(sortLabel(sort))) },
            )
        }
    }
}

private fun sortLabel(sort: HoldingSort) =
    when (sort) {
        HoldingSort.VALUE -> R.string.sort_value
        HoldingSort.GAIN -> R.string.sort_gain
        HoldingSort.WEIGHT -> R.string.sort_weight
        HoldingSort.NAME -> R.string.sort_name
    }

@Composable
private fun SectorRow(
    sectors: List<String>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        item { FilterChip(selected = selected == null, onClick = { onSelect(null) }, label = { Text(stringResource(R.string.sector_all)) }) }
        items(sectors) { sector ->
            FilterChip(selected = sector == selected, onClick = { onSelect(sector) }, label = { Text(sector) })
        }
    }
}

@Composable
private fun HoldingItem(
    row: HoldingRow,
    onOpen: (String) -> Unit,
) {
    val description = "${row.ticker}, ${row.name}, ${moneyShort(row.value)}, ${signedPercent(row.gainPercent)}"
    Card(
        onClick = { onOpen(row.ticker) },
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Column(Modifier.padding(Spacing.lg)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(row.ticker, style = MaterialTheme.typography.titleMedium)
                Text(moneyShort(row.value), style = MaterialTheme.typography.titleMedium)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(row.name, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                val gain = row.gain
                if (gain != null) {
                    val color = if (gain >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                    Text(
                        "${signedMoney(gain)} ${signedPercent(row.gainPercent)}",
                        color = color,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.End,
                    )
                }
            }
            HorizontalDivider(Modifier.padding(vertical = Spacing.sm))
            val priceLine =
                if (row.price != null) {
                    pluralStringResource(R.plurals.holding_priced, row.shares.toInt(), row.shares.toLong(), shortDate(row.priceDate))
                } else {
                    pluralStringResource(R.plurals.holding_no_price, row.shares.toInt(), row.shares.toLong())
                }
            Text(priceLine, style = MaterialTheme.typography.bodySmall)
            if (row.stale) Text(stringResource(R.string.holding_stale), style = MaterialTheme.typography.labelSmall, color = SipwiseTheme.colors.warn)
            if (row.expectedDividend) Text(stringResource(R.string.holding_dividend_expected), style = MaterialTheme.typography.labelSmall)
        }
    }
}
