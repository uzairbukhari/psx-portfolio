package app.sipwise.model

import kotlin.test.Test
import kotlin.test.assertEquals

private const val NBSP = " "

/** Expected strings are what `Intl.NumberFormat('en-PK', PKR)` prints in lib/portfolio.ts. */
class FormatTest {
    @Test
    fun moneyMatchesTheTypeScriptFormatter() {
        assertEquals("Rs${NBSP}0.00", money(0.0))
        assertEquals("Rs${NBSP}0.01", money(0.005))
        assertEquals("Rs${NBSP}1,234.50", money(1234.5))
        assertEquals("-Rs${NBSP}1,200.00", money(-1200.0))
        assertEquals("-Rs${NBSP}0.00", money(-0.001))
        assertEquals("Rs${NBSP}9,999.99", money(9999.994))
        assertEquals("Rs${NBSP}1,234,567.90", money(1234567.895))
        assertEquals("Unknown", money(null))
    }

    @Test
    fun moneyShortDropsPaiseFromTenThousand() {
        assertEquals("Rs${NBSP}9,999.99", moneyShort(9999.994))
        assertEquals("Rs${NBSP}10,000", moneyShort(10000.0))
        assertEquals("Rs${NBSP}1,234,568", moneyShort(1234567.895))
        assertEquals("-Rs${NBSP}12,345,679", moneyShort(-12345678.5))
    }

    @Test
    fun signedValuesUseATrueMinusAndNoSignAtZero() {
        assertEquals("+Rs${NBSP}1,200.00", signedMoney(1200.0, short = false))
        assertEquals("−Rs${NBSP}300.00", signedMoney(-300.0))
        assertEquals("Rs${NBSP}0.00", signedMoney(0.0))
        assertEquals("—", signedMoney(null))
        assertEquals("+12.93%", signedPercent(12.9312))
        assertEquals("−6.90%", signedPercent(-6.9))
        assertEquals("0.00%", signedPercent(0.0))
        assertEquals("—", signedPercent(null))
    }

    @Test
    fun datesAndPlurals() {
        assertEquals("30 Sep", shortDate("2026-09-30", 2026))
        assertEquals("5 Jan 2025", shortDate("2025-01-05", 2026))
        assertEquals("—", shortDate("nope"))
        assertEquals("1 holding", plural(1, "holding"))
        assertEquals("2 holdings", plural(2, "holding"))
    }

    @Test
    fun `formats a timestamp as a medium date`() {
        assertEquals("12 Oct 2026", mediumDate("2026-10-12T08:00:00.000Z"))
        assertEquals("nonsense", mediumDate("nonsense"))
    }
}
