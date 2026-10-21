package app.sipwise.model

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

// Pure chart maths (no Compose), so scales, ticks and the treemap layout are unit tested on the JVM.

/** Round tick values inside [min, max], about [count] of them (1, 2, 2.5, 5 times a power of ten). */
fun niceTicks(
    min: Double,
    max: Double,
    count: Int,
): List<Double> {
    if (!(max > min) || count < 1) return emptyList()
    val raw = (max - min) / count
    val magnitude = 10.0.pow(floor(log10(raw)))
    val step =
        listOf(1.0, 2.0, 2.5, 5.0, 10.0)
            .map { it * magnitude }
            .firstOrNull { it >= raw } ?: (10 * magnitude)
    val first = ceil(min / step) * step
    val out = mutableListOf<Double>()
    var value = first
    while (value <= max + step * TICK_EPSILON) {
        out += (value / step).roundToInt() * step
        value += step
    }
    return out
}

private const val TICK_EPSILON = 1e-9

/** A short axis label: 4.6M, 412k, 380. */
fun compactAxis(value: Double): String {
    val v = abs(value)
    val sign = if (value < 0) "-" else ""
    return when {
        v >= MILLION -> sign + trimZero(v / MILLION, if (v >= TEN_MILLION) 0 else 1) + "M"
        v >= THOUSAND * TEN -> sign + trimZero(v / THOUSAND, 0) + "k"
        v >= THOUSAND -> sign + trimZero(v / THOUSAND, 1) + "k"
        v >= TEN -> sign + trimZero(v, 0)
        else -> sign + trimZero(v, 2)
    }
}

private const val MILLION = 1_000_000.0
private const val TEN_MILLION = 10_000_000.0
private const val THOUSAND = 1_000.0
private const val TEN = 10.0

private fun trimZero(
    value: Double,
    digits: Int,
): String {
    val text = String.format(java.util.Locale.ROOT, "%.${digits}f", value)
    return if (digits > 0 && text.contains('.')) text.trimEnd('0').trimEnd('.') else text
}

/** One rectangle of a treemap, in the units of the width and height it was laid out in. */
data class TreemapCell(
    val index: Int,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
) {
    fun isFinite() = x.isFinite() && y.isFinite() && width.isFinite() && height.isFinite()
}

/**
 * Slice-and-dice treemap: weights in the order given (largest first reads best), split into two halves of near-equal
 * weight along the longer side, recursively. Zero and negative weights get no cell.
 */
fun treemap(
    weights: List<Double>,
    width: Float,
    height: Float,
): List<TreemapCell> {
    val items = weights.mapIndexed { i, w -> i to w }.filter { it.second > 0 && it.second.isFinite() }
    val out = mutableListOf<TreemapCell>()
    layout(items, 0f, 0f, width, height, out)
    return out
}

private fun layout(
    items: List<Pair<Int, Double>>,
    x: Float,
    y: Float,
    width: Float,
    height: Float,
    out: MutableList<TreemapCell>,
) {
    if (items.isEmpty()) return
    if (items.size == 1) {
        out += TreemapCell(items[0].first, x, y, width, height)
        return
    }
    val total = items.sumOf { it.second }
    var acc = 0.0
    var cut = 0
    while (cut < items.size - 1 && acc + items[cut].second < total / 2) {
        acc += items[cut].second
        cut++
    }
    if (cut == 0) {
        acc = items[0].second
        cut = 1
    }
    val share = (acc / total).toFloat()
    val first = items.subList(0, cut)
    val second = items.subList(cut, items.size)
    if (width >= height) {
        layout(first, x, y, width * share, height, out)
        layout(second, x + width * share, y, width * (1 - share), height, out)
    } else {
        layout(first, x, y, width, height * share, out)
        layout(second, x, y + height * share, width, height * (1 - share), out)
    }
}

/** Index of the point whose x is closest to [x] (points are sorted by x); -1 for an empty list. */
fun nearestIndex(
    xs: List<Double>,
    x: Double,
): Int {
    if (xs.isEmpty()) return -1
    var low = 0
    var high = xs.size - 1
    while (low < high) {
        val mid = (low + high) / 2
        if (xs[mid] < x) low = mid + 1 else high = mid
    }
    return if (low > 0 && abs(xs[low - 1] - x) <= abs(xs[low] - x)) low - 1 else low
}

/** Linear value of a series at [x] (clamped to its ends). */
fun valueAt(
    points: List<List<Double>>,
    x: Double,
): Double? {
    val first = points.firstOrNull() ?: return null
    val last = points.last()
    return when {
        x <= first[0] -> first[1]
        x >= last[0] -> last[1]
        else -> interpolate(points, x)
    }
}

private fun interpolate(
    points: List<List<Double>>,
    x: Double,
): Double {
    val i = nearestIndex(points.map { it[0] }, x)
    val a = if (points[i][0] <= x) i else max(i - 1, 0)
    val b = minOf(a + 1, points.size - 1)
    val span = points[b][0] - points[a][0]
    return if (span <= 0) points[a][1] else points[a][1] + (points[b][1] - points[a][1]) * ((x - points[a][0]) / span)
}

/** Value range padded by [pad] of its span on both sides (a flat series gets a symmetric band). */
fun paddedRange(
    values: List<Double>,
    pad: Double = DEFAULT_PAD,
): Pair<Double, Double> {
    if (values.isEmpty()) return 0.0 to 1.0
    val lo = values.min()
    val hi = values.max()
    if (hi - lo < FLAT) {
        val band = max(abs(hi) * FLAT_BAND, 1.0)
        return lo - band to hi + band
    }
    val span = hi - lo
    return lo - span * pad to hi + span * pad
}

private const val DEFAULT_PAD = 0.06
private const val FLAT = 1e-9
private const val FLAT_BAND = 0.02

/**
 * The visible part of a zoomed chart, as fractions (0 to 1) of the full x range. Pinch changes the width around a
 * focus point; two fingers or the mini-map move it. Never narrower than [MIN_WIDTH] and never outside 0..1.
 */
data class ZoomWindow(
    val start: Float = 0f,
    val end: Float = 1f,
) {
    val width: Float get() = end - start
    val zoomed: Boolean get() = width < FULL_WIDTH - EPS

    /** Scale the window by [factor] (above 1 zooms in) keeping the point at [focus] (0 to 1 of the window) still. */
    fun zoom(
        factor: Float,
        focus: Float,
    ): ZoomWindow {
        if (!(factor > 0f)) return this
        val newWidth = (width / factor).coerceIn(MIN_WIDTH, FULL_WIDTH)
        val anchor = start + width * focus.coerceIn(0f, 1f)
        return moved(anchor - newWidth * focus.coerceIn(0f, 1f), newWidth)
    }

    /** Move the window by [delta] of the full range (positive shows later data). */
    fun pan(delta: Float): ZoomWindow = moved(start + delta, width)

    private fun moved(
        newStart: Float,
        newWidth: Float,
    ): ZoomWindow {
        val s = newStart.coerceIn(0f, FULL_WIDTH - newWidth)
        return ZoomWindow(s, s + newWidth)
    }

    companion object {
        const val MIN_WIDTH = 0.04f
        private const val FULL_WIDTH = 1f
        private const val EPS = 1e-4f
    }
}

/** Points whose x falls inside [from], [to] (points are sorted by x), plus one neighbour each side so lines reach the edge. */
fun visiblePoints(
    points: List<List<Double>>,
    from: Double,
    to: Double,
): List<List<Double>> {
    if (points.size < 2) return points
    val xs = points.map { it[0] }
    var first = xs.indexOfFirst { it >= from }
    var last = xs.indexOfLast { it <= to }
    if (first < 0) first = points.size - 1
    if (last < 0) last = 0
    first = max(first - 1, 0)
    last = minOf(last + 1, points.size - 1)
    return if (first > last) points.takeLast(2) else points.subList(first, last + 1)
}

/** Running totals: 1, 2, 3 becomes 1, 3, 6. */
fun cumulative(values: List<Double>): List<Double> {
    var sum = 0.0
    return values.map {
        sum += it
        sum
    }
}

/** Index of the bar under [x] when [count] equal slots fill [width]; -1 outside the chart. */
fun slotAt(
    x: Float,
    width: Float,
    count: Int,
): Int {
    if (count <= 0 || width <= 0f) return -1
    if (x < 0f || x > width) return -1
    return minOf((x / width * count).toInt(), count - 1)
}

/**
 * Stacked tops for a stacked area chart: each layer's y becomes its own value plus every layer below it, so the
 * areas can be drawn back to front without overlapping. Layers must share their x values; a short layer is left as
 * far as it goes.
 */
fun stackLayers(layers: List<List<List<Double>>>): List<List<List<Double>>> {
    val tops = mutableListOf<List<List<Double>>>()
    val running = mutableMapOf<Double, Double>()
    for (layer in layers) {
        tops +=
            layer.map { point ->
                val x = point[0]
                val top = (running[x] ?: 0.0) + point[1]
                running[x] = top
                listOf(x, top)
            }
    }
    return tops
}

/** How far a series moved over the window it covers, for the chart's spoken summary. Null with fewer than two points. */
data class Trend(val change: Double, val percent: Double) {
    val up: Boolean get() = change > 0
}

fun trend(points: List<List<Double>>): Trend? {
    if (points.size < 2) return null
    val first = points.first()[1]
    val last = points.last()[1]
    return Trend(last - first, if (first != 0.0) (last - first) / kotlin.math.abs(first) * PERCENT else 0.0)
}

private const val PERCENT = 100.0
