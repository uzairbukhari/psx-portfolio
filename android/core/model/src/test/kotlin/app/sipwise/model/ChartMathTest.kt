package app.sipwise.model

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

    @Test
    fun `zoom keeps the focus point still and stays inside the range`() {
        val z = ZoomWindow().zoom(4f, 0.5f)
        assertEquals(0.25f, z.width, 1e-4f)
        assertEquals(0.375f, z.start, 1e-4f)
        assertTrue(z.zoomed)
        val edge = ZoomWindow().zoom(4f, 0f)
        assertEquals(0f, edge.start, 1e-4f)
        assertEquals(ZoomWindow.MIN_WIDTH, ZoomWindow().zoom(1000f, 0.5f).width, 1e-4f)
        assertEquals(1f, z.zoom(0.01f, 0.5f).width, 1e-4f)
    }

    @Test
    fun `pan is clamped to the data`() {
        val z = ZoomWindow(0.4f, 0.6f)
        assertEquals(0.5f, z.pan(0.1f).start, 1e-4f)
        assertEquals(0.8f, z.pan(5f).start, 1e-4f)
        assertEquals(0f, z.pan(-5f).start, 1e-4f)
        assertEquals(false, ZoomWindow().zoomed)
    }

    @Test
    fun `visible points keep a neighbour each side`() {
        val pts = (0..10).map { listOf(it.toDouble(), it * 2.0) }
        val seen = visiblePoints(pts, 4.0, 6.0)
        assertEquals(listOf(3.0, 4.0, 5.0, 6.0, 7.0), seen.map { it[0] })
        assertEquals(pts, visiblePoints(pts, -5.0, 50.0))
    }

    @Test
    fun `cumulative and slots`() {
        assertEquals(listOf(1.0, 3.0, 6.0), cumulative(listOf(1.0, 2.0, 3.0)))
        assertEquals(0, slotAt(10f, 100f, 4))
        assertEquals(3, slotAt(100f, 100f, 4))
        assertEquals(-1, slotAt(-1f, 100f, 4))
    }

    @Test
    fun `stacked layers add up and keep their x values`() {
        val a = listOf(listOf(1.0, 10.0), listOf(2.0, 20.0))
        val b = listOf(listOf(1.0, 5.0), listOf(2.0, 5.0))
        val tops = stackLayers(listOf(a, b))
        assertEquals(listOf(10.0, 20.0), tops[0].map { it[1] })
        assertEquals(listOf(15.0, 25.0), tops[1].map { it[1] })
        assertEquals(listOf(1.0, 2.0), tops[1].map { it[0] })
        assertEquals(emptyList<List<List<Double>>>(), stackLayers(emptyList()))
    }

    @Test
    fun `trend reads the move over the window`() {
        val up = trend(listOf(listOf(0.0, 100.0), listOf(1.0, 111.0)))!!
        assertEquals(11.0, up.change, 1e-9)
        assertEquals(11.0, up.percent, 1e-9)
        assertTrue(up.up)
        val down = trend(listOf(listOf(0.0, 100.0), listOf(1.0, 90.0)))!!
        assertEquals(-10.0, down.percent, 1e-9)
        assertEquals(false, down.up)
        // A flat start cannot give a percentage, and one point is no trend at all.
        assertEquals(0.0, trend(listOf(listOf(0.0, 0.0), listOf(1.0, 5.0)))!!.percent, 1e-9)
        assertEquals(null, trend(listOf(listOf(0.0, 1.0))))
    }
}
