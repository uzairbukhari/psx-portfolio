package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.MonthBuy
import app.sipwise.model.PlanRow
import app.sipwise.model.PlanView
import app.sipwise.model.ReviewRow
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.monthTitle
import app.sipwise.model.shiftMonth
import app.sipwise.model.shortDate

@Composable
fun PlanScreen(
    viewModel: PlanViewModel,
    onEditTargets: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val view = ui.view
    if (view == null) {
        if (ui.error != null) Text(ui.error.orEmpty(), modifier = Modifier.padding(Spacing.gutter)) else LoadingScreen()
        return
    }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        item { BudgetCard(view, onShift = viewModel::shift, onEdit = { viewModel.editBudget(true) }) }
        if (view.bought.isNotEmpty()) {
            item { Text(pluralStringResource(R.plurals.plan_bought_title, view.bought.size, monthTitle(view.month, false), view.bought.size), style = MaterialTheme.typography.titleMedium) }
            items(view.bought, key = { it.id }) { BoughtItem(it) }
        }
        if (view.targetedCount == 0) {
            item { NoTargets(view, onEditTargets) }
        } else {
            item { PlanBody(view, ui, viewModel, onEditTargets) }
            item { PlanSettings(ui, viewModel) }
        }
    }
    if (ui.editingBudget) {
        BudgetDialog(view, ui.busy, ui.error, onSave = viewModel::saveBudget, onDismiss = { viewModel.editBudget(false) })
    }
    ui.review?.let { ReviewDialog(view, ui, it, viewModel) }
}

@Composable
private fun BudgetCard(
    view: PlanView,
    onShift: (Int) -> Unit,
    onEdit: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { onShift(-1) }) { Text(stringResource(R.string.plan_prev, monthTitle(shiftMonth(view.month, -1)))) }
                TextButton(onClick = { onShift(1) }) { Text(stringResource(R.string.plan_next, monthTitle(shiftMonth(view.month, 1)))) }
            }
            Text(monthTitle(view.month), style = MaterialTheme.typography.titleLarge)
            Text(
                stringResource(
                    when {
                        view.month == view.now -> R.string.plan_this_month
                        view.month > view.now -> R.string.plan_upcoming
                        else -> R.string.plan_past
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                if (view.budgetSet) moneyShort(view.plan?.budget ?: view.budget) else stringResource(R.string.plan_budget_not_set),
                style = MaterialTheme.typography.headlineMedium,
            )
            val plan = view.plan
            if (plan != null && view.budgetSet && plan.budget > 0) {
                LinearProgressIndicator(progress = { (plan.already / plan.budget).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                Column {
                    Text(stringResource(R.string.plan_bought), style = MaterialTheme.typography.labelMedium)
                    Text(moneyShort(plan?.already ?: 0.0), style = MaterialTheme.typography.titleMedium)
                }
                if (view.budgetSet) {
                    Column {
                        Text(stringResource(R.string.plan_left), style = MaterialTheme.typography.labelMedium)
                        Text(moneyShort(plan?.remaining ?: 0.0), style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            val monthName = monthTitle(view.month, false)
            val label = if (view.budgetSet) stringResource(R.string.plan_edit_budget, monthName) else stringResource(R.string.plan_set_budget, monthName)
            if (view.budgetSet) {
                OutlinedButton(onClick = onEdit, enabled = !view.readOnly) { Text(label) }
            } else {
                Button(onClick = onEdit, enabled = !view.readOnly) { Text(label) }
            }
        }
    }
}

@Composable
private fun BoughtItem(buy: MonthBuy) {
    Column {
        ListItem(
            headlineContent = { Text(buy.ticker) },
            supportingContent = {
                val price = buy.price?.let { " @ ${money(it)}" }.orEmpty()
                Text("${pluralStringResource(R.plurals.plan_shares, buy.shares.toInt(), buy.shares.toInt())}$price · ${shortDate(buy.date)}")
            },
            trailingContent = { Text(money(buy.amount)) },
        )
        HorizontalDivider()
    }
}

@Composable
private fun NoTargets(
    view: PlanView,
    onEditTargets: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.plan_no_targets_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.plan_no_targets_body), style = MaterialTheme.typography.bodyMedium)
            if (view.companyCount == 0) Text(stringResource(R.string.plan_no_companies), style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onEditTargets, enabled = !view.readOnly && view.companyCount > 0) { Text(stringResource(R.string.plan_set_targets)) }
        }
    }
}

@Composable
private fun PlanBody(
    view: PlanView,
    ui: PlanUi,
    viewModel: PlanViewModel,
    onEditTargets: () -> Unit,
) {
    val plan = view.plan
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        view.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (view.targetState.status != "exact") {
            Text(stringResource(R.string.plan_targets_total, view.targetState.total.toInt()), style = MaterialTheme.typography.bodyMedium)
        }
        OutlinedButton(onClick = onEditTargets, enabled = !view.readOnly, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.plan_edit_targets))
        }
        view.priceErrors.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (plan != null && !view.budgetSet) {
            Text(stringResource(R.string.plan_set_budget_prompt, monthTitle(view.month)), style = MaterialTheme.typography.bodyMedium)
        }
        if (plan != null && view.budgetSet) view.otherErrors.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (view.complete) Text(stringResource(R.string.plan_complete), style = MaterialTheme.typography.titleSmall)
        if (plan != null && view.budgetSet && plan.errors.isEmpty()) {
            Text(stringResource(R.string.plan_suggested), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.plan_suggested_note, money(plan.invested), money(plan.leftover)), style = MaterialTheme.typography.bodySmall)
            plan.rows.forEach { SuggestionItem(it) }
            if (view.receivers.size > 1 && view.buys.isNotEmpty() && !view.readOnly) {
                Text(stringResource(R.string.plan_record_in), style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    items(view.receivers, key = { it.id }) {
                        FilterChip(
                            selected = (ui.receiverId ?: view.homeId) == it.id,
                            onClick = { viewModel.setReceiver(it.id) },
                            label = { Text(it.name) },
                        )
                    }
                }
                Text(stringResource(R.string.plan_record_in_note), style = MaterialTheme.typography.bodySmall)
            }
            if (view.buys.isNotEmpty() && !view.readOnly) {
                Button(onClick = viewModel::openReview, modifier = Modifier.fillMaxWidth()) {
                    Text(pluralStringResource(R.plurals.plan_record_all, view.buys.size, view.buys.size))
                }
            }
        }
    }
}

@Composable
private fun SuggestionItem(row: PlanRow) {
    Column {
        ListItem(
            headlineContent = { Text(row.ticker) },
            supportingContent = {
                Column {
                    Text(row.name, maxLines = 1)
                    Text(
                        stringResource(
                            R.string.plan_row_weights,
                            "%.1f".format(row.currentWeight),
                            "%.0f".format(row.target),
                            row.price?.let { money(it) } ?: stringResource(R.string.plan_price_missing),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    val target = row.target
                    LinearProgressIndicator(
                        progress = { if (target > 0) (row.currentWeight / target).toFloat().coerceIn(0f, 1f) else 0f },
                        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
                    )
                }
            },
            trailingContent = {
                Column(horizontalAlignment = Alignment.End) {
                    Text(if (row.shares > 0) pluralStringResource(R.plurals.plan_shares, row.shares.toInt(), row.shares.toInt()) else "—")
                    Text(if (row.amount > 0) money(row.amount) else row.reason, style = MaterialTheme.typography.bodySmall)
                }
            },
        )
        HorizontalDivider()
    }
}

@Composable
private fun PlanSettings(
    ui: PlanUi,
    viewModel: PlanViewModel,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.plan_settings), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = ui.fee,
                onValueChange = viewModel::setFee,
                label = { Text(stringResource(R.string.plan_fee)) },
                supportingText = { Text(stringResource(R.string.plan_fee_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.plan_old_quotes))
                    Text(stringResource(R.string.plan_old_quotes_hint), style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = ui.allowOld, onCheckedChange = viewModel::setAllowOld)
            }
        }
    }
}

@Composable
private fun BudgetDialog(
    view: PlanView,
    busy: Boolean,
    error: String?,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var amount by remember(view.month) { mutableStateOf(view.budget?.toLong()?.toString().orEmpty()) }
    val title = monthTitle(view.month)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.plan_budget_title, title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text(stringResource(R.string.plan_budget_label, title)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                Text(stringResource(R.string.plan_budget_note, title), style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(amount) }, enabled = !busy) { Text(stringResource(if (busy) R.string.entry_saving else R.string.entry_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

@Composable
private fun ReviewDialog(
    view: PlanView,
    ui: PlanUi,
    review: ReviewState,
    viewModel: PlanViewModel,
) {
    val count = review.rows.count { it.ticker !in review.excluded }
    AlertDialog(
        onDismissRequest = viewModel::closeReview,
        title = { Text(stringResource(R.string.plan_review_title)) },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                item { Text(stringResource(R.string.plan_review_note), style = MaterialTheme.typography.bodySmall) }
                items(review.rows, key = { it.ticker }) { row -> ReviewItem(row, row.ticker in review.excluded, review.result.errors[row.ticker], viewModel) }
                item {
                    Text(stringResource(R.string.plan_review_total, money(review.result.total)), style = MaterialTheme.typography.titleMedium)
                    Text(
                        stringResource(R.string.plan_review_breakdown, money(review.result.gross), money(review.result.fees), ui.fee, view.month),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            Button(onClick = viewModel::record, enabled = !ui.busy && count > 0) {
                Text(pluralStringResource(R.plurals.plan_record_buys, count, count))
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeReview) { Text(stringResource(R.string.entry_cancel)) } },
    )
}

@Composable
private fun ReviewItem(
    row: ReviewRow,
    off: Boolean,
    problem: String?,
    viewModel: PlanViewModel,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(row.ticker, style = MaterialTheme.typography.titleSmall)
            FilterChip(
                selected = !off,
                onClick = { viewModel.toggleRow(row.ticker) },
                label = { Text(stringResource(if (off) R.string.plan_review_left_out else R.string.plan_review_included)) },
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedTextField(
                value = row.shares,
                onValueChange = { viewModel.editRow(row.ticker, shares = it) },
                label = { Text(stringResource(R.string.entry_shares)) },
                enabled = !off,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = row.price,
                onValueChange = { viewModel.editRow(row.ticker, price = it) },
                label = { Text(stringResource(R.string.entry_price)) },
                enabled = !off,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f),
            )
        }
        if (!off && problem != null) Text(problem, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
}
