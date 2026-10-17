package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.sipwise.R
import app.sipwise.designsystem.DeltaPill
import app.sipwise.designsystem.ListRow
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.model.AssetsView
import app.sipwise.model.CurrencyRow
import app.sipwise.model.FundRow
import app.sipwise.model.MetalRow
import app.sipwise.model.PlanAssetRow
import app.sipwise.model.money
import app.sipwise.model.moneyShort
import app.sipwise.model.shortDate
import app.sipwise.model.signedMoney

private const val DASH = "—"
private const val GRAM_DECIMALS = 3

private fun trimmed(value: Double) = java.math.BigDecimal(value).setScale(GRAM_DECIMALS, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

/** Funds, savings plans, then gold and silver, in the chosen scope. Read-only on the phone. */
@Composable
fun AssetSections(
    assets: AssetsView,
    year: Int,
) {
    if (assets.funds.isNotEmpty()) {
        Section(R.string.assets_funds, assets.funds.size, assets.funds.takeIf { rows -> rows.none { it.value == null } }?.sumOf { it.value ?: 0.0 }, card = false) {
            FundGroups(assets.funds, year)
        }
    }
    if (assets.plans.isNotEmpty()) {
        Section(R.string.assets_plans, assets.plans.size, assets.plans.sumOf { it.value }) {
            assets.plans.forEach { PlanItem(it, year) }
        }
    }
    if (assets.currencies.isNotEmpty()) {
        Section(R.string.assets_currencies, assets.currencies.size, assets.currencies.takeIf { rows -> rows.none { it.value == null } }?.sumOf { it.value ?: 0.0 }) {
            assets.currencies.forEach { CurrencyItem(it, year) }
        }
    }
    if (assets.metals.isNotEmpty()) {
        Section(R.string.assets_metals, assets.metals.size, assets.metals.takeIf { rows -> rows.none { it.value == null } }?.sumOf { it.value ?: 0.0 }) {
            assets.metals.forEach { MetalItem(it, year) }
        }
    }
}

@Composable
private fun Section(
    title: Int,
    count: Int,
    total: Double?,
    card: Boolean = true,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.assets_section_header, stringResource(title), count), style = MaterialTheme.typography.titleMedium)
            total?.let { Text(moneyShort(it), style = MaterialTheme.typography.titleMedium) }
        }
        if (card) SipwiseCard(Modifier.fillMaxWidth()) { Column { content() } } else content()
    }
}

@Composable
private fun Item(
    description: String,
    content: @Composable () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(Spacing.md).semantics(mergeDescendants = true) { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) { content() }
    HorizontalDivider()
}

@Composable
private fun Head(
    name: String,
    sub: String,
    portfolio: String,
    value: String,
    gain: Double?,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleSmall)
            if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall)
            if (portfolio.isNotEmpty()) Text(portfolio, style = MaterialTheme.typography.labelSmall)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            gain?.let {
                val tone = if (it >= 0) SipwiseTheme.colors.gain else SipwiseTheme.colors.loss
                Text(signedMoney(it), color = tone, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Facts(vararg facts: Pair<String, String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        facts.forEach { (label, value) ->
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelSmall)
                Text(value, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** Funds grouped by the company that manages them (largest first): a quiet label per manager, then one card of simple rows. */
@Composable
private fun FundGroups(
    funds: List<FundRow>,
    year: Int,
) {
    val unknown = stringResource(R.string.assets_amc_unknown)
    val groups = funds.groupBy { it.amc.ifBlank { unknown } }.entries.sortedByDescending { (_, rows) -> rows.sumOf { it.value ?: 0.0 } }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        groups.forEach { (amc, rows) ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.xs), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(amc, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(moneyShort(rows.sumOf { it.value ?: 0.0 }), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                SipwiseCard(Modifier.fillMaxWidth()) {
                    rows.forEachIndexed { index, fund ->
                        FundItem(fund, year)
                        if (index < rows.lastIndex) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
                    }
                }
            }
        }
    }
}

@Composable
private fun FundItem(
    fund: FundRow,
    year: Int,
) {
    val value = fund.value?.let { moneyShort(it) } ?: DASH
    val price = fund.price
    val units = stringResource(R.string.assets_fund_units, trimmed(fund.units))
    val detail =
        when {
            price == null -> stringResource(R.string.assets_no_price)
            price.stale -> stringResource(if (price.source == "manual") R.string.assets_price_manual_old else R.string.assets_price_mufap_old, shortDate(price.date, year))
            else -> listOf(units, stringResource(R.string.assets_fund_price, "%.2f".format(java.util.Locale.ROOT, price.nav))).joinToString(" · ")
        }
    ListRow(
        title = fund.name,
        modifier = Modifier.padding(horizontal = Spacing.lg).semantics(mergeDescendants = true) { contentDescription = "${fund.name}, $value" },
        subtitle = detail,
        trailing = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MoneyText(value, style = SipwiseNumbers.small)
                fund.gain?.let { DeltaPill(signedMoney(it), positive = it >= 0) }
            }
        },
    )
}

@Composable
private fun CurrencyItem(
    row: CurrencyRow,
    year: Int,
) {
    val value = row.value?.let { moneyShort(it) } ?: DASH
    val rate = row.rate
    val detail =
        when {
            rate == null -> stringResource(R.string.assets_no_price)
            else ->
                stringResource(
                    if (rate.kind == "interbank") R.string.assets_fx_interbank else R.string.assets_fx_open_market,
                    "%.2f".format(java.util.Locale.ROOT, rate.pkrPerUnit),
                    shortDate(rate.date, year),
                )
        }
    Item("${row.name}, $value") {
        Head(row.name, "${trimmed(row.units)} ${row.currency}", row.portfolio, value, row.gain)
        Text(detail, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun PlanItem(
    plan: PlanAssetRow,
    year: Int,
) {
    Item("${plan.name}, ${moneyShort(plan.value)}") {
        Head(plan.name, stringResource(if (plan.closed) R.string.assets_closed else R.string.assets_active), plan.portfolio, moneyShort(plan.value), plan.gain)
        Facts(
            stringResource(R.string.assets_paid_in) to moneyShort(plan.contributed),
            stringResource(R.string.assets_redeemed) to moneyShort(plan.redeemed),
            stringResource(R.string.assets_still_in) to moneyShort(plan.cost),
        )
        Text(
            when (plan.source) {
                "statement" -> stringResource(R.string.assets_plan_statement, shortDate(plan.statementDate, year))
                "estimate" -> stringResource(R.string.assets_plan_estimate, shortDate(plan.statementDate, year))
                else -> stringResource(R.string.assets_plan_none)
            },
            style = MaterialTheme.typography.bodySmall,
        )
        if (plan.dueCount > 0) {
            Text(pluralStringResource(R.plurals.assets_plan_due, plan.dueCount, plan.dueCount, money(plan.dueAmount)), color = SipwiseTheme.colors.warn, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun MetalItem(
    metal: MetalRow,
    year: Int,
) {
    val value = metal.value?.let { moneyShort(it) } ?: stringResource(R.string.assets_rate_needed)
    Item("${metal.name}, ${trimmed(metal.grams)} grams, $value") {
        Head(
            metal.name,
            stringResource(R.string.assets_grams_tola, trimmed(metal.grams), "%.2f".format(java.util.Locale.ROOT, metal.tola)),
            metal.portfolio,
            value,
            metal.gain,
        )
        if (metal.gain == null && !metal.costKnown) Text(stringResource(R.string.assets_cost_unknown), style = MaterialTheme.typography.bodySmall)
        Facts(
            stringResource(R.string.assets_bought) to "${trimmed(metal.boughtGrams)} g",
            stringResource(R.string.assets_sold) to "${trimmed(metal.soldGrams)} g",
            stringResource(R.string.assets_realised) to (metal.realized?.let { signedMoney(it) } ?: DASH),
        )
        metal.recent.forEach { e ->
            val word =
                when (e.kind) {
                    "opening" -> stringResource(R.string.assets_opening)
                    "buy" -> stringResource(R.string.assets_bought)
                    else -> stringResource(R.string.assets_sold)
                }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${shortDate(e.date, year)} · $word ${e.pieces}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(e.amount?.let { money(it) } ?: stringResource(R.string.assets_entry_cost_unknown), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (metal.olderCount > 0) Text(stringResource(R.string.assets_older), style = MaterialTheme.typography.bodySmall)
        metal.rate?.let {
            val kind = stringResource(if (it.kind == "local") R.string.assets_rate_dealer else R.string.assets_rate_intl)
            Text(stringResource(R.string.assets_metal_rate, money(it.pkrPerTola), kind, shortDate(it.date, year)), style = MaterialTheme.typography.bodySmall)
        }
    }
}
