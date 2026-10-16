package app.sipwise.designsystem

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChartMathTest {
    @Test
    fun `ticks are round numbers inside the range`() {
        val ticks = niceTicks(3.62, 4.83, 3)
        assertTrue(ticks.isNotEmpty())
        assertTrue(ticks.all { it >= 3.62 && it <= 4.83 })
        assertEquals(listOf(4.0, 4.5), ticks)
    }

    @Test
    fun `flat range gives no ticks`() {
        assertTrue(niceTicks(5.0, 5.0, 3).isEmpty())
    }

    @Test
    fun `axis labels are short`() {
        assertEquals("4.6M", compactAxis(4_600_000.0))
        assertEquals("412k", compactAxis(412_000.0))
        assertEquals("8.5k", compactAxis(8_500.0))
        assertEquals("380", compactAxis(380.0))
        assertEquals("-34k", compactAxis(-34_000.0))
    }

    @Test
    fun `treemap fills the area and keeps weights proportional`() {
        val cells = treemap(listOf(31.6, 19.8, 16.3, 13.0, 10.7, 8.6), 300f, 170f)
        assertEquals(6, cells.size)
        val area = cells.sumOf { (it.width * it.height).toDouble() }
        assertEquals(300.0 * 170.0, area, 1.0)
        val first = cells.first { it.index == 0 }
        assertEquals(31.6 / 100.0, (first.width * first.height) / (300f * 170f).toDouble(), 0.005)
    }

    @Test
    fun `treemap skips zero weights`() {
        val cells = treemap(listOf(5.0, 0.0, 5.0), 100f, 100f)
        assertEquals(listOf(0, 2), cells.map { it.index }.sorted())
    }

    @Test
    fun `nearest index picks the closer neighbour`() {
        val xs = listOf(0.0, 10.0, 20.0, 30.0)
        assertEquals(1, nearestIndex(xs, 12.0))
        assertEquals(2, nearestIndex(xs, 16.0))
        assertEquals(0, nearestIndex(xs, -5.0))
        assertEquals(3, nearestIndex(xs, 99.0))
        assertEquals(-1, nearestIndex(emptyList(), 1.0))
    }

    @Test
    fun `value at interpolates between points`() {
        val points = listOf(listOf(0.0, 100.0), listOf(10.0, 200.0))
        assertEquals(150.0, valueAt(points, 5.0))
        assertEquals(100.0, valueAt(points, -1.0))
        assertEquals(200.0, valueAt(points, 50.0))
    }

    @Test
    fun `padded range widens and handles a flat series`() {
        val (lo, hi) = paddedRange(listOf(10.0, 20.0))
        assertTrue(lo < 10.0 && hi > 20.0)
        val (flatLo, flatHi) = paddedRange(listOf(7.0, 7.0))
        assertTrue(flatLo < 7.0 && flatHi > 7.0)
    }
}
