package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.EmptyState
import app.sipwise.designsystem.IconTile
import app.sipwise.designsystem.ListRow
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ProgressRing
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.SlabColors
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
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else ScreenSkeleton()
        return
    }
    if (view.firstUse && !ui.skippedWelcome) {
        WelcomeCard(onAdd = onAddEntry, onSkip = viewModel::skipWelcome)
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(horizontal = Spacing.gutter, vertical = Spacing.sm),
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
    NightSlab(Modifier.fillMaxWidth()) {
        val incomplete = summary.incomplete.isNotEmpty()
        Overline(stringResource(if (incomplete) R.string.today_hero_incomplete else R.string.today_hero_label), color = SlabColors.muted)
        summary.oldestQuoteDate?.let { Text(shortDate(it), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
        MoneyText(moneyShort(summary.value), style = SipwiseNumbers.hero, color = SlabColors.ink)
        val gain = summary.gain
        if (gain == null) {
            Text(stringResource(R.string.today_gain_unknown), style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                DeltaPill("${signedMoney(gain)} (${signedPercent(summary.gainPercent)})", positive = gain >= 0, onSlab = true)
                Text(stringResource(R.string.today_gain_label), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
            }
        }
        HorizontalDivider(color = SlabColors.track)
        SlabLine(stringResource(R.string.today_cost), summary.cost?.let(::moneyShort) ?: stringResource(R.string.today_not_known))
        SlabLine(stringResource(R.string.today_holdings), plural(openCount, "company", "companies"))
        if (showReturn && breakdown != null) ReturnLines(breakdown)
        TextButton(onClick = onToggle) {
            Text(stringResource(if (showReturn) R.string.today_hide_return else R.string.today_see_return), color = BrandColors.sky)
        }
    }
}

@Composable
private fun SlabLine(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted)
        MoneyText(value, style = SipwiseNumbers.small, color = SlabColors.ink)
    }
}

@Composable
private fun ReturnLines(b: ReturnBreakdown) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HorizontalDivider(color = SlabColors.track)
        ReturnLine(stringResource(R.string.return_unrealised), b.unrealised, colored = true)
        ReturnLine(stringResource(R.string.return_realised), b.realised, colored = true)
        ReturnLine(stringResource(R.string.return_dividends), b.dividendsReceived, colored = false)
        ReturnLine(stringResource(R.string.return_total), b.totalBeforeTax, colored = true)
        b.afterTax?.let { Text(stringResource(R.string.return_after_tax, signedMoney(it)), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted) }
        Text(stringResource(R.string.return_note), style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
    }
}

@Composable
private fun ReturnLine(
    label: String,
    value: Double?,
    colored: Boolean,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = SlabColors.muted, modifier = Modifier.weight(1f))
        when {
            value == null -> MoneyText(stringResource(R.string.today_not_known), style = SipwiseNumbers.small, color = SlabColors.muted)
            colored -> MoneyText(signedMoney(value), style = SipwiseNumbers.small, color = if (value >= 0) SlabColors.gain else SlabColors.loss)
            else -> MoneyText(moneyShort(value), style = SipwiseNumbers.small, color = SlabColors.ink)
        }
    }
}

@Composable
private fun MonthCard(progress: MonthProgress) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(Spacing.lg), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            if (progress.budgetSet) {
                ProgressRing(progress.fraction.toFloat().coerceIn(0f, 1f), centerText = "${(progress.fraction * PERCENT).toInt()}%")
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Overline(stringResource(R.string.month_title, monthTitle(progress.month)))
                if (progress.budgetSet) {
                    MoneyText(moneyShort(progress.bought), style = SipwiseNumbers.large)
                    Text(stringResource(R.string.month_of_budget, moneyShort(progress.budget)), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        if (progress.remaining > 0) stringResource(R.string.month_left, moneyShort(progress.remaining)) else stringResource(R.string.month_all_invested),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (progress.suggested > 0) {
                        Text(
                            pluralStringResource(R.plurals.month_suggested, progress.suggested, progress.suggested),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                } else {
                    Text(stringResource(R.string.month_no_budget, monthTitle(progress.month, withYear = false)), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private const val PERCENT = 100

@Composable
private fun ActionsCard(
    actions: List<NextAction>,
    pricing: Boolean,
    onAction: (NextAction) -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        actions.forEachIndexed { index, action ->
            ListRow(
                title = action.title,
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = if (action.key == "prices" && pricing) stringResource(R.string.holdings_refreshing) else action.detail,
                onClick = { onAction(action) },
                leading = { IconTile(actionIcon(action.key), actionTint(action.key)) },
            )
            if (index < actions.lastIndex) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
        }
    }
}

private fun actionIcon(key: String) =
    when (key) {
        "dividend" -> Icons.Outlined.Payments
        "prices" -> Icons.Outlined.Refresh
        "targets" -> Icons.Outlined.Flag
        else -> Icons.Outlined.Timeline
    }

@Composable
private fun actionTint(key: String) =
    when (key) {
        "dividend" -> SipwiseTheme.colors.gain
        "prices" -> SipwiseTheme.colors.assetFunds
        "targets" -> SipwiseTheme.colors.assetGold
        else -> MaterialTheme.colorScheme.primary
    }

/** First-use welcome: add a first holding or skip, like the Expo app. */
@Composable
private fun WelcomeCard(
    onAdd: () -> Unit,
    onSkip: () -> Unit,
) {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        EmptyState(stringResource(R.string.welcome_title), stringResource(R.string.welcome_subtitle))
        Overline(stringResource(R.string.welcome_start))
        SipwiseCard(Modifier.fillMaxWidth()) {
            ListRow(
                title = stringResource(R.string.welcome_add_title),
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = stringResource(R.string.welcome_add_detail),
                onClick = onAdd,
            )
            HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
            ListRow(
                title = stringResource(R.string.welcome_skip_title),
                modifier = Modifier.padding(horizontal = Spacing.lg),
                subtitle = stringResource(R.string.welcome_skip_detail),
                onClick = onSkip,
            )
        }
        Text(stringResource(R.string.welcome_note), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}
