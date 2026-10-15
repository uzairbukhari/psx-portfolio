package app.sipwise.model

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

private const val NBSP = ' '
private const val MINUS = '−'
private const val WHOLE_FROM = 10_000.0
private const val PAISE_DIGITS = 2
private val SYMBOLS = DecimalFormatSymbols(Locale.ROOT)
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

private fun grouped(
    amount: Double,
    digits: Int,
): String {
    val rounded = BigDecimal(amount.toString()).setScale(digits, RoundingMode.HALF_UP)
    val pattern = if (digits == 0) "#,##0" else "#,##0.${"0".repeat(digits)}"
    return DecimalFormat(pattern, SYMBOLS).format(rounded)
}

/** "Rs 1,234.50", same text as `money()` in lib/portfolio.ts (Intl en-PK): no-break space, western grouping. */
fun money(value: Double?): String {
    if (value == null) return "Unknown"
    val text = "Rs$NBSP${grouped(kotlin.math.abs(value), PAISE_DIGITS)}"
    return if (value < 0) "-$text" else text
}

/** `money()` without paise for big summary figures (|amount| >= 10,000). */
fun moneyShort(value: Double?): String {
    if (value == null || kotlin.math.abs(value) < WHOLE_FROM) return money(value)
    val text = "Rs$NBSP${grouped(kotlin.math.abs(value), 0)}"
    return if (value < 0) "-$text" else text
}

/** "+Rs 1,200" / "−Rs 300" (no sign at zero); [short] drops paise for big figures. */
fun signedMoney(
    value: Double?,
    short: Boolean = true,
): String {
    if (value == null) return "—"
    val format: (Double?) -> String = if (short) ::moneyShort else ::money
    if (value == 0.0) return format(0.0)
    return "${if (value > 0) '+' else MINUS}${format(kotlin.math.abs(value))}"
}

/** "+12.93%" / "−6.90%". */
fun signedPercent(value: Double?): String {
    if (value == null) return "—"
    if (value == 0.0) return "0.00%"
    return "${if (value > 0) '+' else MINUS}${grouped(kotlin.math.abs(value), PAISE_DIGITS).replace(",", "")}%"
}

/** "30 Sep" for a YYYY-MM-DD date; other years than [thisYear] show the year. */
fun shortDate(
    iso: String?,
    thisYear: Int? = null,
): String {
    if (iso == null || !ISO_DATE.matches(iso)) return "—"
    val year = iso.substring(0, 4).toInt()
    val month = iso.substring(5, 7).toInt()
    val day = iso.substring(8, 10).toInt()
    val label = "$day ${MONTHS[month - 1]}"
    return if (thisYear != null && year != thisYear) "$label $year" else label
}

fun plural(
    count: Int,
    one: String,
    many: String = "${one}s",
) = "$count ${if (count == 1) one else many}"
