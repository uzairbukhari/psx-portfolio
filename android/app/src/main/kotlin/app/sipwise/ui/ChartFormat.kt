package app.sipwise.ui

import app.sipwise.model.HistoryRange
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val HOUR_MINUTE = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)
private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
private val MONTH_YEAR = DateTimeFormatter.ofPattern("MMM yy", Locale.ENGLISH)

/** Axis and crosshair labels for a price chart whose x values are unix seconds. */
fun timeLabel(range: HistoryRange): (Double) -> String {
    val pattern =
        when (range) {
            HistoryRange.DAY -> HOUR_MINUTE
            HistoryRange.WEEK, HistoryRange.MONTH, HistoryRange.MONTHS3 -> DAY_MONTH
            HistoryRange.MONTHS6, HistoryRange.YEAR, HistoryRange.YEARS3, HistoryRange.YEARS5 -> MONTH_YEAR
        }
    val zone = ZoneId.systemDefault()
    return { seconds -> pattern.format(Instant.ofEpochSecond(seconds.toLong()).atZone(zone)) }
}

/** Axis labels for the track record, whose x values are days since 1970. */
fun dayLabel(days: Double): String = DAY_MONTH_YEAR.format(java.time.LocalDate.ofEpochDay(days.toLong()))

private val DAY_MONTH_YEAR = DateTimeFormatter.ofPattern("MMM yy", Locale.ENGLISH)
