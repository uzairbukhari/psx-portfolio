package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.model.monthTitle
import app.sipwise.model.shiftMonth
import java.time.Month
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

private const val MONTHS_PER_ROW = 3
private const val MONTHS_PER_YEAR = 12

/**
 * Optional month field (the SIP month): step one month at a time, or pick a month and year in a dialog.
 * [value] is `YYYY-MM` or empty; opening an empty field selects the current month, like the Expo app.
 */
@Composable
fun MonthPickerField(
    label: String,
    value: String,
    enabled: Boolean,
    onChange: (String) -> Unit,
) {
    val current = YearMonth.now()
    val selected = runCatching { YearMonth.parse(value) }.getOrNull()
    var open by remember { mutableStateOf(false) }
    var year by remember { mutableIntStateOf((selected ?: current).year) }
    val step = { delta: Int -> onChange(shiftMonth((selected ?: current).toString(), delta)) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TextButton(onClick = { step(-1) }, enabled = enabled) { Text(stringResource(R.string.month_picker_prev)) }
            OutlinedButton(
                onClick = {
                    year = (selected ?: current).year
                    if (selected == null) onChange(current.toString())
                    open = true
                },
                enabled = enabled,
                modifier = Modifier.weight(1f),
            ) { Text(if (selected == null) stringResource(R.string.month_picker_none) else monthTitle(selected.toString())) }
            TextButton(onClick = { step(1) }, enabled = enabled) { Text(stringResource(R.string.month_picker_next)) }
        }
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { year -= 1 }) { Text(stringResource(R.string.month_picker_prev_year)) }
                        Text(year.toString(), style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { year += 1 }) { Text(stringResource(R.string.month_picker_next_year)) }
                    }
                    for (first in 1..MONTHS_PER_YEAR step MONTHS_PER_ROW) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            for (m in first until first + MONTHS_PER_ROW) {
                                MonthChip(m, YearMonth.of(year, m), selected) {
                                    onChange(it.toString())
                                    open = false
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.month_picker_use)) } },
            dismissButton = {
                TextButton(
                    onClick = {
                        onChange("")
                        open = false
                    },
                ) { Text(stringResource(R.string.month_picker_clear)) }
            },
        )
    }
}

@Composable
private fun RowScope.MonthChip(
    number: Int,
    month: YearMonth,
    selected: YearMonth?,
    onPick: (YearMonth) -> Unit,
) {
    FilterChip(
        selected = month == selected,
        onClick = { onPick(month) },
        label = { Text(Month.of(number).getDisplayName(TextStyle.SHORT, Locale.ENGLISH), modifier = Modifier.padding(horizontal = Spacing.xs)) },
        modifier = Modifier.weight(1f),
    )
}
