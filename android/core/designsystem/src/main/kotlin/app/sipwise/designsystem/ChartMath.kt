package app.sipwise.designsystem

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/** Pure chart maths (no Compose), so scales, ticks and the treemap layout are unit tested on the JVM. */

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
)

/**
 * Slice-and-dice treemap: weights in the order given (largest first reads best), split into two halves of near-equal
 * weight along the longer side, recursively. Zero and negative weights get no cell.
 */
fun treemap(
    weights: List<Double>,
    width: Float,
    height: Float,
): List<TreemapCell> {
    val items = weights.mapIndexed { i, w -> i to w }.filter { it.second > 0 }
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
    if (points.isEmpty()) return null
    if (x <= points.first()[0]) return points.first()[1]
    if (x >= points.last()[0]) return points.last()[1]
    val i = nearestIndex(points.map { it[0] }, x)
    val a = if (points[i][0] <= x) i else max(i - 1, 0)
    val b = minOf(a + 1, points.size - 1)
    val span = points[b][0] - points[a][0]
    if (span <= 0) return points[a][1]
    return points[a][1] + (points[b][1] - points[a][1]) * ((x - points[a][0]) / span)
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
