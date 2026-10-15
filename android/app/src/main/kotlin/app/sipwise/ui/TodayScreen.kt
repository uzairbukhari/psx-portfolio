package app.sipwise.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.MonthProgress
import app.sipwise.model.NextAction
import app.sipwise.model.PortfolioSummary
import app.sipwise.model.ReturnBreakdown
import app.sipwise.model.moneyShort
import app.sipwise.model.monthTitle
import app.sipwise.model.plural
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney
import app.sipwise.model.signedPercent

@Composable
fun TodayScreen(
    viewModel: TodayViewModel,
    onOpenCompany: (String) -> Unit,
    onOpenTargets: () -> Unit,
    onOpenPlan: () -> Unit,
    onAddEntry: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    if (view.firstUse && !ui.skippedWelcome) {
        WelcomeCard(onAdd = onAddEntry, onSkip = viewModel::skipWelcome)
        return
    }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (view.firstUse) {
            item { Text(stringResource(R.string.today_first_use), style = MaterialTheme.typography.bodyLarge) }
            return@LazyColumn
        }
        view.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        item { HeroCard(view.summary, view.openCount, view.breakdown, ui.showReturn, viewModel::toggleReturn) }
        item { MonthCard(view.progress) }
        if (view.actions.isNotEmpty()) {
            item { Text(stringResource(R.string.actions_title), style = MaterialTheme.typography.titleMedium) }
            item {
                ActionsCard(view.actions, ui.pricing) { action ->
                    when (action.key) {
                        "dividend" -> action.ticker?.let(onOpenCompany)
                        "prices" -> viewModel.refreshPrices()
                        "targets" -> onOpenTargets()
                        else -> onOpenPlan()
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(
    summary: PortfolioSummary,
    openCount: Int,
    breakdown: ReturnBreakdown?,
    showReturn: Boolean,
    onToggle: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val incomplete = summary.incomplete.isNotEmpty()
            Text(
                stringResource(if (incomplete) R.string.today_hero_incomplete else R.string.today_hero_label),
                style = MaterialTheme.typography.labelLarge,
            )
            summary.oldestQuoteDate?.let { Text(shortDate(it), style = MaterialTheme.typography.bodySmall) }
            Text(moneyShort(summary.value), style = MaterialTheme.typography.displaySmall)
            val gain = summary.gain
            if (gain == null) {
                Text(stringResource(R.string.today_gain_unknown), style = MaterialTheme.typography.bodyMedium)
            } else {
                Text(
                    "${signedMoney(gain)} (${signedPercent(summary.gainPercent)})",
                    color = gainColor(gain),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(stringResource(R.string.today_gain_label), style = MaterialTheme.typography.bodySmall)
            }
            HorizontalDivider()
            LabelledValue(stringResource(R.string.today_cost), summary.cost?.let(::moneyShort) ?: stringResource(R.string.today_not_known))
            LabelledValue(stringResource(R.string.today_holdings), plural(openCount, "company", "companies"))
            if (showReturn && breakdown != null) ReturnLines(breakdown)
            TextButton(onClick = onToggle) {
                Text(stringResource(if (showReturn) R.string.today_hide_return else R.string.today_see_return))
            }
        }
    }
}

@Composable
private fun ReturnLines(b: ReturnBreakdown) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HorizontalDivider()
        ReturnLine(stringResource(R.string.return_unrealised), b.unrealised, colored = true)
        ReturnLine(stringResource(R.string.return_realised), b.realised, colored = true)
        ReturnLine(stringResource(R.string.return_dividends), b.dividendsReceived, colored = false)
        ReturnLine(stringResource(R.string.return_total), b.totalBeforeTax, colored = true)
        b.afterTax?.let { Text(stringResource(R.string.return_after_tax, signedMoney(it)), style = MaterialTheme.typography.bodySmall) }
        Text(stringResource(R.string.return_note), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ReturnLine(
    label: String,
    value: Double?,
    colored: Boolean,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        when {
            value == null -> Text(stringResource(R.string.today_not_known), style = MaterialTheme.typography.bodyMedium)
            colored -> Text(signedMoney(value), color = gainColor(value), style = MaterialTheme.typography.bodyMedium)
            else -> Text(moneyShort(value), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun gainColor(value: Double) = if (value >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss

@Composable
private fun LabelledValue(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun MonthCard(progress: MonthProgress) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.month_title, monthTitle(progress.month)), style = MaterialTheme.typography.labelLarge)
            if (progress.budgetSet) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(moneyShort(progress.bought), style = MaterialTheme.typography.titleLarge)
                    Text(stringResource(R.string.month_of_budget, moneyShort(progress.budget)), style = MaterialTheme.typography.bodyMedium)
                }
                LinearProgressIndicator(progress = { progress.fraction.toFloat() }, modifier = Modifier.fillMaxWidth())
                Text(
                    if (progress.remaining > 0) stringResource(R.string.month_left, moneyShort(progress.remaining)) else stringResource(R.string.month_all_invested),
                    style = MaterialTheme.typography.bodySmall,
                )
                if (progress.suggested > 0) {
                    Text(pluralStringResource(R.plurals.month_suggested, progress.suggested, progress.suggested), style = MaterialTheme.typography.labelLarge)
                }
            } else {
                Text(stringResource(R.string.month_no_budget, monthTitle(progress.month, withYear = false)), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun ActionsCard(
    actions: List<NextAction>,
    pricing: Boolean,
    onAction: (NextAction) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column {
            actions.forEachIndexed { index, action ->
                ListItem(
                    headlineContent = { Text(action.title) },
                    supportingContent = {
                        Text(if (action.key == "prices" && pricing) stringResource(R.string.holdings_refreshing) else action.detail)
                    },
                    modifier = Modifier.clickable { onAction(action) },
                )
                if (index < actions.lastIndex) HorizontalDivider()
            }
        }
    }
}

/** First-use welcome: add a first holding or skip, like the Expo app. */
@Composable
private fun WelcomeCard(
    onAdd: () -> Unit,
    onSkip: () -> Unit,
) {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.welcome_subtitle), style = MaterialTheme.typography.bodyLarge)
        Text(stringResource(R.string.welcome_start), style = MaterialTheme.typography.labelLarge)
        Card(Modifier.fillMaxWidth()) {
            Column {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.welcome_add_title)) },
                    supportingContent = { Text(stringResource(R.string.welcome_add_detail)) },
                    modifier = Modifier.clickable(onClick = onAdd),
                )
                HorizontalDivider()
                ListItem(
                    headlineContent = { Text(stringResource(R.string.welcome_skip_title)) },
                    supportingContent = { Text(stringResource(R.string.welcome_skip_detail)) },
                    modifier = Modifier.clickable(onClick = onSkip),
                )
            }
        }
        Text(stringResource(R.string.welcome_note), style = MaterialTheme.typography.bodySmall)
    }
}
