package app.sipwise.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sipwise.model.compactAxis
import app.sipwise.model.nearestIndex
import app.sipwise.model.niceTicks
import app.sipwise.model.paddedRange
import app.sipwise.model.treemap
import app.sipwise.model.valueAt
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min

/** One line (or area) on an [AreaChart]; points are [x, y] pairs sorted by x. */
data class ChartSeries(
    val points: List<List<Double>>,
    val color: Color,
    val dashed: Boolean = false,
    val stepped: Boolean = false,
    val fill: Boolean = false,
)

/** A horizontal line across the chart with a tag at the axis, such as the average cost. */
data class ChartReference(
    val y: Double,
    val label: String,
    val color: Color,
)

/** A dot placed on the chart, such as a buy. */
data class ChartMarker(
    val x: Double,
    val y: Double,
    val color: Color,
)

internal const val ANIMATION_MS = 450
internal const val LABEL_SP = 10
internal const val GRID_TICKS = 3
internal const val X_LABELS = 5
internal const val FILL_TOP_ALPHA = 0.30f
internal const val DOT_HALO_ALPHA = 0.22f
internal const val GRID_DASH = 4f

internal fun smooth(points: List<Offset>): Path =
    Path().apply {
        if (points.isEmpty()) return@apply
        moveTo(points[0].x, points[0].y)
        for (i in 0 until points.size - 1) {
            val p0 = points[max(i - 1, 0)]
            val p1 = points[i]
            val p2 = points[i + 1]
            val p3 = points[min(i + 2, points.size - 1)]
            cubicTo(
                p1.x + (p2.x - p0.x) / 6,
                p1.y + (p2.y - p0.y) / 6,
                p2.x - (p3.x - p1.x) / 6,
                p2.y - (p3.y - p1.y) / 6,
                p2.x,
                p2.y,
            )
        }
    }

internal fun stepped(points: List<Offset>): Path =
    Path().apply {
        if (points.isEmpty()) return@apply
        moveTo(points[0].x, points[0].y)
        for (i in 1 until points.size) {
            lineTo(points[i].x, points[i - 1].y)
            lineTo(points[i].x, points[i].y)
        }
    }

/** A tag pill with centred text, drawn at [topLeft]; the text is dark or light depending on [fill]. */
internal fun DrawScope.tag(
    measurer: TextMeasurer,
    text: String,
    topLeft: Offset,
    fill: Color,
    style: TextStyle,
    padding: Float,
) {
    val layout = measurer.measure(text, style)
    drawRoundRect(
        fill,
        topLeft,
        Size(layout.size.width + padding * 2, layout.size.height + padding),
        CornerRadius(padding * 2),
    )
    val ink = if (fill.luminance() > INK_THRESHOLD) Color(0xFF0B1430) else Color.White
    drawText(measurer, text, Offset(topLeft.x + padding, topLeft.y + padding / 2), style.copy(color = ink))
}

internal const val INK_THRESHOLD = 0.4f

/** The chart's frame: where the plot sits on the canvas and how data maps onto it. */
internal class Plot(
    val left: Float,
    val right: Float,
    val top: Float,
    val bottom: Float,
    val minX: Double,
    val spanX: Double,
    val lo: Double,
    val hi: Double,
) {
    fun x(value: Double) = left + ((value - minX) / spanX).toFloat() * (right - left)

    fun y(value: Double) = top + (1 - ((value - lo) / (hi - lo)).toFloat()) * (bottom - top)
}

/** Colours and text styles of one chart, resolved once from the theme. */
internal class ChartInk(
    val grid: Color,
    val label: Color,
    val bubble: Color,
    val surface: Color,
    val labelStyle: TextStyle,
    val bubbleStyle: TextStyle,
)

internal fun DrawScope.drawAxes(
    plot: Plot,
    ink: ChartInk,
    measurer: TextMeasurer,
    yLabel: (Double) -> String,
    xLabel: (Double) -> String,
    xTicks: List<Double>? = null,
) {
    val dash = PathEffect.dashPathEffect(floatArrayOf(GRID_DASH.dp.toPx(), GRID_DASH.dp.toPx()))
    for (tick in niceTicks(plot.lo, plot.hi, GRID_TICKS)) {
        val y = plot.y(tick)
        drawLine(ink.grid, Offset(plot.left, y), Offset(plot.right, y), 1.dp.toPx(), pathEffect = dash)
        val text = yLabel(tick)
        val width = measurer.measure(text, ink.labelStyle).size.width
        drawText(measurer, text, Offset(size.width - width, y - LABEL_SP.sp.toPx() / 2 - 1.dp.toPx()), ink.labelStyle)
    }
    val ticks = xTicks ?: List(X_LABELS) { plot.minX + plot.spanX * it / (X_LABELS - 1) }
    for (x in ticks) {
        val text = xLabel(x)
        if (text.isEmpty()) continue
        val layout = measurer.measure(text, ink.labelStyle)
        val left = (plot.x(x) - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width)
        drawText(measurer, text, Offset(left, size.height - layout.size.height), ink.labelStyle)
    }
}

internal fun DrawScope.drawSeries(
    plot: Plot,
    series: List<ChartSeries>,
    progress: Float,
) {
    clipRect(left = 0f, top = 0f, right = plot.left + (plot.right - plot.left) * progress + 1f, bottom = size.height) {
        for (line in series) {
            if (line.points.size < 2) continue
            val pts = line.points.map { Offset(plot.x(it[0]), plot.y(it[1])) }
            val path = if (line.stepped) stepped(pts) else smooth(pts)
            if (line.fill) {
                val area =
                    Path().apply {
                        addPath(path)
                        lineTo(pts.last().x, plot.bottom)
                        lineTo(pts.first().x, plot.bottom)
                        close()
                    }
                val fade = listOf(line.color.copy(alpha = FILL_TOP_ALPHA), line.color.copy(alpha = 0f))
                drawPath(area, Brush.verticalGradient(fade, startY = plot.top, endY = plot.bottom))
            }
            val effect = if (line.dashed) PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())) else null
            val width = (if (line.dashed) 1.4f else 2.2f).dp.toPx()
            drawPath(path, line.color, style = Stroke(width = width, cap = StrokeCap.Round, pathEffect = effect))
        }
    }
}

internal fun DrawScope.drawScrub(
    plot: Plot,
    ink: ChartInk,
    measurer: TextMeasurer,
    series: List<ChartSeries>,
    fraction: Float,
    title: String,
    detail: String,
) {
    val x = plot.left + fraction * (plot.right - plot.left)
    val dataX = plot.minX + plot.spanX * fraction
    drawLine(ink.label, Offset(x, plot.top - 4.dp.toPx()), Offset(x, plot.bottom), 1.dp.toPx())
    series.forEach { line ->
        val y = valueAt(line.points, dataX) ?: return@forEach
        drawCircle(line.color.copy(alpha = DOT_HALO_ALPHA), 9.dp.toPx(), Offset(x, plot.y(y)))
        drawCircle(line.color, 4.5f.dp.toPx(), Offset(x, plot.y(y)))
        drawCircle(ink.surface, 2.dp.toPx(), Offset(x, plot.y(y)))
    }
    val text = if (title.isEmpty()) detail else "$title  $detail"
    val layout = measurer.measure(text, ink.bubbleStyle)
    val padding = 6.dp.toPx()
    val left = (x - layout.size.width / 2f - padding).coerceIn(0f, size.width - layout.size.width - padding * 2)
    tag(measurer, text, Offset(left, 0f), ink.bubble, ink.bubbleStyle, padding)
}

/**
 * Lines and areas on one scale: a faint grid with real labels, the last point emphasised, an optional reference line
 * and markers, a draw-in animation and a press-and-drag crosshair with a value bubble and haptic ticks.
 */
@Suppress("CyclomaticComplexMethod")
@Composable
fun AreaChart(
    series: List<ChartSeries>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 160.dp,
    onSlab: Boolean = false,
    showAxes: Boolean = true,
    xLabel: (Double) -> String = { "" },
    yLabel: (Double) -> String = ::compactAxis,
    scrubDetail: ((x: Double, ys: List<Double?>) -> String)? = null,
    references: List<ChartReference> = emptyList(),
    markers: List<ChartMarker> = emptyList(),
    /** Where to put x labels; by default five evenly spaced ones. */
    xTicks: List<Double>? = null,
) {
    val all = series.flatMap { it.points }
    if (all.size < 2) return
    val ink = chartInk(onSlab)
    val measurer = rememberTextMeasurer()
    val haptic = LocalHapticFeedback.current
    val motion = rememberMotionEnabled()
    val progress = remember { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(series) {
        if (motion) {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(ANIMATION_MS))
        }
    }
    var scrub by remember { mutableStateOf<Float?>(null) }
    var lastIndex by remember { mutableIntStateOf(-1) }
    val minX = all.minOf { it[0] }
    val spanX = (all.maxOf { it[0] } - minX).takeIf { it > 0 } ?: 1.0
    val (lo, hi) = paddedRange(all.map { it[1] } + references.map { it.y })
    val xs = series.firstOrNull { it.points.isNotEmpty() }?.points?.map { it[0] }.orEmpty()
    val axisWidth = if (showAxes) 40.dp else 0.dp
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .semantics { contentDescription = description }
            .pointerInput(series) {
                val plotWidth = size.width - axisWidth.toPx()

                fun move(x: Float) {
                    val fraction = (x / plotWidth).coerceIn(0f, 1f)
                    scrub = fraction
                    val index = nearestIndex(xs, minX + spanX * fraction)
                    if (index != lastIndex) {
                        lastIndex = index
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    }
                }
                detectHorizontalDragGestures(
                    onDragStart = { move(it.x) },
                    onDragEnd = { scrub = null },
                    onDragCancel = { scrub = null },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        move(change.position.x)
                    },
                )
            }.pointerInput(series) {
                val plotWidth = size.width - axisWidth.toPx()
                detectTapGestures(
                    onPress = {
                        scrub = (it.x / plotWidth).coerceIn(0f, 1f)
                        tryAwaitRelease()
                        scrub = null
                    },
                )
            },
    ) {
        val plot =
            Plot(
                left = 0f,
                right = size.width - axisWidth.toPx(),
                top = BUBBLE_ROOM.dp.toPx(),
                bottom = size.height - (if (showAxes) X_AXIS_ROOM.dp else 4.dp).toPx(),
                minX = minX,
                spanX = spanX,
                lo = lo,
                hi = hi,
            )
        if (showAxes) drawAxes(plot, ink, measurer, yLabel, xLabel, xTicks)
        for (ref in references) {
            val y = plot.y(ref.y)
            val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))
            drawLine(ref.color, Offset(plot.left, y), Offset(plot.right, y), 1.2.dp.toPx(), pathEffect = dash)
            tag(measurer, ref.label, Offset(plot.right + 3.dp.toPx(), y - 9.dp.toPx()), ref.color, ink.labelStyle, 5.dp.toPx())
        }
        drawSeries(plot, series, progress.value)
        for (marker in markers) {
            val c = Offset(plot.x(marker.x), plot.y(marker.y))
            drawCircle(ink.surface, 6.dp.toPx(), c)
            drawCircle(marker.color, 4.dp.toPx(), c)
        }
        val head = series.firstOrNull { it.fill }
        val frac = scrub
        if (frac == null && head != null && progress.value >= 1f) {
            head.points.lastOrNull()?.let { last ->
                val c = Offset(plot.x(last[0]), plot.y(last[1]))
                drawCircle(head.color.copy(alpha = DOT_HALO_ALPHA), 9.dp.toPx(), c)
                drawCircle(head.color, 4.dp.toPx(), c)
            }
        }
        if (frac != null) {
            val dataX = plot.minX + plot.spanX * frac
            val ys = series.map { valueAt(it.points, dataX) }
            val detail = scrubDetail?.invoke(dataX, ys) ?: ys.firstOrNull()?.let(yLabel).orEmpty()
            drawScrub(plot, ink, measurer, series, frac, xLabel(dataX), detail)
        }
    }
}

internal const val GRID_SLAB_ALPHA = 0.08f
internal const val BUBBLE_ROOM = 24
internal const val X_AXIS_ROOM = 16

/** One slice of a [DonutChart]; [fraction] is 0 to 1. */
data class DonutSlice(
    val label: String,
    val fraction: Double,
    val color: Color,
)

private const val FULL_CIRCLE = 360f
private const val TOP_ANGLE = -90f
private const val DONUT_GAP_DEGREES = 2f
private const val DIMMED_ALPHA = 0.3f
private const val RAD_TO_DEG = (180.0 / PI).toFloat()

/** An asset-mix donut with rounded segments; tap a segment to focus it, tap again to clear. */
@Composable
fun DonutChart(
    slices: List<DonutSlice>,
    focused: Int?,
    centerLabel: String,
    centerValue: String,
    description: String,
    modifier: Modifier = Modifier,
    size: Dp = 128.dp,
    onFocus: (Int?) -> Unit = {},
) {
    val motion = rememberMotionEnabled()
    val sweep = remember { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(slices) {
        if (motion) {
            sweep.snapTo(0f)
            sweep.animateTo(1f, tween(ANIMATION_MS + 150))
        }
    }
    Box(modifier.size(size).semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .size(size)
                .pointerInput(slices, focused) {
                    detectTapGestures { tap ->
                        val dx = tap.x - this.size.width / 2f
                        val dy = tap.y - this.size.height / 2f
                        var angle = atan2(dy, dx) * RAD_TO_DEG - TOP_ANGLE
                        if (angle < 0) angle += FULL_CIRCLE
                        var start = 0f
                        var hit: Int? = null
                        slices.forEachIndexed { i, s ->
                            val end = start + s.fraction.toFloat() * FULL_CIRCLE
                            if (angle >= start && angle < end) hit = i
                            start = end
                        }
                        onFocus(if (hit == focused) null else hit)
                    }
                },
        ) {
            val thick = 18.dp.toPx()
            val inset = thick / 2
            val arc = Size(this.size.width - thick, this.size.height - thick)
            val radius = arc.width / 2
            val capDegrees = thick / radius * RAD_TO_DEG
            var start = TOP_ANGLE
            slices.forEachIndexed { i, slice ->
                val full = slice.fraction.toFloat() * FULL_CIRCLE * sweep.value
                val on = focused == i
                val width = if (on) thick + 4.dp.toPx() else thick
                val gap = capDegrees + DONUT_GAP_DEGREES
                val visible = (full - gap).coerceAtLeast(0.5f)
                val alpha = if (focused == null || on) 1f else DIMMED_ALPHA
                drawArc(
                    slice.color.copy(alpha = alpha),
                    start + gap / 2,
                    visible,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arc,
                    style = Stroke(width, cap = StrokeCap.Round),
                )
                start += full
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(centerLabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            MoneyText(centerValue, style = SipwiseNumbers.small)
        }
    }
}

/** A circular progress with the brand gradient, with optional centre text. */
@Composable
fun ProgressRing(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 84.dp,
    stroke: Dp = 9.dp,
    centerText: String? = null,
) {
    val motion = rememberMotionEnabled()
    val shown = remember { Animatable(if (motion) 0f else progress) }
    LaunchedEffect(progress) { shown.animateTo(progress.coerceIn(0f, 1f), tween(ANIMATION_MS + 150)) }
    val track = MaterialTheme.colorScheme.surfaceContainerHigh
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val inset = stroke.toPx() / 2
            val arc = Size(this.size.width - inset * 2, this.size.height - inset * 2)
            drawArc(track, 0f, FULL_CIRCLE, useCenter = false, topLeft = Offset(inset, inset), size = arc, style = Stroke(stroke.toPx()))
            val p = shown.value.coerceIn(MIN_RING, 1f)
            rotate(TOP_ANGLE, center) {
                drawArc(
                    Brush.sweepGradient(0f to BrandColors.sky, p to BrandColors.mint, 1f to BrandColors.mint, center = center),
                    0f,
                    FULL_CIRCLE * shown.value,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arc,
                    style = Stroke(stroke.toPx(), cap = StrokeCap.Round),
                )
            }
        }
        if (centerText != null) Text(centerText, style = SipwiseNumbers.medium)
    }
}

private const val MIN_RING = 0.02f

/** One month on a [Staircase]: [done] when something was bought in it. */
data class StairStep(
    val label: String,
    val done: Boolean,
    val current: Boolean = false,
)

/** One bar per month, each a step higher than the last; this month's step fills as you buy. */
@Composable
fun Staircase(
    steps: List<StairStep>,
    currentFill: Float,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 118.dp,
) {
    if (steps.isEmpty()) return
    val scheme = MaterialTheme.colorScheme
    val measurer = rememberTextMeasurer()
    val motion = rememberMotionEnabled()
    val grow = remember { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(steps, currentFill) { if (motion) grow.animateTo(1f, tween(ANIMATION_MS)) }
    val labelStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = LABEL_SP.sp, color = scheme.onSurfaceVariant)
    Canvas(modifier.fillMaxWidth().height(height).semantics { contentDescription = description }) {
        val gap = 6.dp.toPx()
        val barW = (size.width - gap * (steps.size - 1)) / steps.size
        val room = 16.dp.toPx()
        val top = 12.dp.toPx()
        val usable = size.height - room - top
        steps.forEachIndexed { i, step ->
            val h = (MIN_STEP + (1 - MIN_STEP) * (i + 1f) / steps.size) * usable * grow.value
            val x = i * (barW + gap)
            val y = size.height - room - h
            val radius = CornerRadius(6.dp.toPx())
            when {
                step.current -> {
                    drawRoundRect(scheme.surfaceContainerHigh, Offset(x, y), Size(barW, h), radius)
                    val fill = h * currentFill.coerceIn(0f, 1f)
                    if (fill > 0f) {
                        drawRoundRect(
                            Brush.verticalGradient(listOf(BrandColors.mint, BrandColors.blue), startY = y + h - fill, endY = y + h),
                            Offset(x, y + h - fill),
                            Size(barW, fill),
                            radius,
                        )
                    }
                    drawCircle(BrandColors.mint, 4.dp.toPx(), Offset(x + barW / 2, y - 8.dp.toPx()))
                }
                step.done -> drawRoundRect(BrandColors.blue.copy(alpha = DONE_LOW + DONE_SPAN * i / steps.size), Offset(x, y), Size(barW, h), radius)
                else ->
                    drawRoundRect(
                        scheme.outlineVariant,
                        Offset(x, y),
                        Size(barW, h),
                        radius,
                        style = Stroke(1.2f.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
                    )
            }
            val layout = measurer.measure(step.label, labelStyle)
            drawText(measurer, step.label, Offset(x + (barW - layout.size.width) / 2, size.height - layout.size.height), labelStyle)
        }
    }
}

private const val MIN_STEP = 0.18f
private const val DONE_LOW = 0.30f
private const val DONE_SPAN = 0.55f

/** A company in a [Treemap]: size follows [weight], colour follows [change]. */
data class TreemapItem(
    val id: String,
    val label: String,
    val weight: Double,
    val change: Double?,
)

private const val CHANGE_FULL = 30.0
private const val TILE_GAP = 2f

/** Allocation as blocks: size is weight, green or red is the gain, deeper is bigger. Tap a block to open it. */
@Composable
fun Treemap(
    items: List<TreemapItem>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 170.dp,
    onClick: (String) -> Unit = {},
) {
    val sorted = remember(items) { items.sortedByDescending { it.weight } }
    val measurer = rememberTextMeasurer()
    val colors = SipwiseTheme.colors
    val scheme = MaterialTheme.colorScheme
    val titleStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurface)
    val subStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = 10.sp, color = scheme.onSurfaceVariant)
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .semantics { contentDescription = description }
            .pointerInput(sorted) {
                detectTapGestures { tap ->
                    val cells = treemap(sorted.map { it.weight }, size.width.toFloat(), size.height.toFloat())
                    cells.firstOrNull { tap.x >= it.x && tap.x <= it.x + it.width && tap.y >= it.y && tap.y <= it.y + it.height }
                        ?.let { onClick(sorted[it.index].id) }
                }
            },
    ) {
        val total = sorted.sumOf { it.weight }.takeIf { it > 0 } ?: 1.0
        for (cell in treemap(sorted.map { it.weight }, size.width, size.height)) {
            if (!cell.isFinite()) continue
            val item = sorted[cell.index]
            val change = item.change
            val tone =
                when {
                    change == null -> scheme.outline
                    change >= 0 -> colors.gain
                    else -> colors.loss
                }
            val strength = if (change == null) TREEMAP_BASE else TREEMAP_BASE + TREEMAP_SPAN * min(abs(change) / CHANGE_FULL, 1.0).toFloat()
            val gap = TILE_GAP.dp.toPx()
            val topLeft = Offset(cell.x + gap, cell.y + gap)
            val box = Size((cell.width - gap * 2).coerceAtLeast(1f), (cell.height - gap * 2).coerceAtLeast(1f))
            drawRoundRect(tone.copy(alpha = strength), topLeft, box, CornerRadius(10.dp.toPx()))
            val pad = 8.dp.toPx()
            if (box.width > 30.dp.toPx() && box.height > 26.dp.toPx()) {
                drawText(measurer, item.label, Offset(topLeft.x + pad, topLeft.y + pad - 2.dp.toPx()), titleStyle)
                drawText(measurer, "%.1f%%".format(java.util.Locale.ROOT, item.weight / total * 100), Offset(topLeft.x + pad, topLeft.y + pad + 12.dp.toPx()), subStyle)
                if (change != null && box.height > 58.dp.toPx()) {
                    val text = (if (change > 0) "+" else "") + "%.1f%%".format(java.util.Locale.ROOT, change)
                    drawText(measurer, text, Offset(topLeft.x + pad, topLeft.y + box.height - pad - 12.dp.toPx()), subStyle.copy(color = tone, fontSize = 10.5.sp))
                }
            }
        }
    }
}

private const val TREEMAP_BASE = 0.2f
private const val TREEMAP_SPAN = 0.5f

/** One company in [DivergingBars]. */
data class BarRow(
    val id: String,
    val label: String,
    val value: Double,
)

private const val ROW_HEIGHT = 26

/** Gains to the right of a zero line, losses to the left, on one scale. */
@Composable
fun DivergingBars(
    rows: List<BarRow>,
    valueLabel: (Double) -> String,
    description: String,
    modifier: Modifier = Modifier,
    onClick: (String) -> Unit = {},
) {
    if (rows.isEmpty()) return
    val measurer = rememberTextMeasurer()
    val colors = SipwiseTheme.colors
    val scheme = MaterialTheme.colorScheme
    val labelStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurface)
    Canvas(
        modifier
            .fillMaxWidth()
            .height((ROW_HEIGHT * rows.size).dp)
            .semantics { contentDescription = description }
            .pointerInput(rows) {
                detectTapGestures { tap ->
                    val index = (tap.y / (ROW_HEIGHT.dp.toPx())).toInt()
                    rows.getOrNull(index)?.let { onClick(it.id) }
                }
            },
    ) {
        val labelW = 54.dp.toPx()
        val valueW = 56.dp.toPx()
        val space = size.width - labelW - valueW
        val maxPos = rows.maxOf { max(it.value, 0.0) }
        val maxNeg = rows.maxOf { max(-it.value, 0.0) }
        val span = (maxPos + maxNeg).takeIf { it > 0 } ?: 1.0
        val zero = labelW + space * (maxNeg / span).toFloat()
        val scale = (space / span).toFloat()
        drawLine(scheme.outlineVariant, Offset(zero, 0f), Offset(zero, size.height), 1.dp.toPx())
        rows.forEachIndexed { i, row ->
            val y = i * ROW_HEIGHT.dp.toPx() + 4.dp.toPx()
            val barH = 16.dp.toPx()
            drawText(measurer, row.label, Offset(0f, y + 1.dp.toPx()), labelStyle)
            val w = abs(row.value).toFloat() * scale
            val tone = if (row.value >= 0) colors.gain else colors.loss
            val left = if (row.value >= 0) zero else zero - w
            drawRoundRect(tone.copy(alpha = 0.85f), Offset(left, y), Size(w.coerceAtLeast(2.dp.toPx()), barH), CornerRadius(5.dp.toPx()))
            val text = valueLabel(row.value)
            val style = labelStyle.copy(fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = tone)
            val layout = measurer.measure(text, style)
            val x = if (row.value >= 0) zero + w + 6.dp.toPx() else max(zero - w - 6.dp.toPx() - layout.size.width, labelW - 4.dp.toPx())
            drawText(measurer, text, Offset(x, y + 1.dp.toPx()), style)
        }
    }
}

/** One month in [MonthBars]; an [expected] amount is drawn as a dashed outline. */
data class MonthBar(
    val label: String,
    val value: Double,
    val expected: Boolean = false,
)

/** One bar per month with a small baseline nub for empty months; expected amounts are dashed outlines. */
@Composable
fun MonthBars(
    bars: List<MonthBar>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 96.dp,
    color: Color = SipwiseTheme.colors.gain,
) {
    if (bars.isEmpty()) return
    val scheme = MaterialTheme.colorScheme
    val measurer = rememberTextMeasurer()
    val motion = rememberMotionEnabled()
    val grow = remember { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(bars) { if (motion) grow.animateTo(1f, tween(ANIMATION_MS)) }
    val labelStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = 9.sp, color = scheme.onSurfaceVariant)
    Canvas(modifier.fillMaxWidth().height(height).semantics { contentDescription = description }) {
        val gap = 5.dp.toPx()
        val barW = (size.width - gap * (bars.size - 1)) / bars.size
        val room = 16.dp.toPx()
        val usable = size.height - room - 4.dp.toPx()
        val top = bars.maxOf { it.value }.takeIf { it > 0 } ?: 1.0
        bars.forEachIndexed { i, bar ->
            val x = i * (barW + gap)
            drawRoundRect(scheme.surfaceContainerHigh, Offset(x, size.height - room - 4.dp.toPx()), Size(barW, 4.dp.toPx()), CornerRadius(2.dp.toPx()))
            if (bar.value > 0) {
                val h = (bar.value / top).toFloat() * usable * grow.value
                val y = size.height - room - h
                if (bar.expected) {
                    drawRoundRect(
                        color,
                        Offset(x + 1.dp.toPx(), y),
                        Size(barW - 2.dp.toPx(), h),
                        CornerRadius(5.dp.toPx()),
                        style = Stroke(1.5f.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.5f.dp.toPx()))),
                    )
                } else {
                    drawRoundRect(color, Offset(x, y), Size(barW, h), CornerRadius(5.dp.toPx()))
                }
            }
            val layout = measurer.measure(bar.label, labelStyle)
            drawText(measurer, bar.label, Offset(x + (barW - layout.size.width) / 2, size.height - layout.size.height), labelStyle)
        }
    }
}

/** A segment of a [SplitBar]. */
data class Split(
    val weight: Float,
    val color: Color,
)

/** One thin bar split into proportional parts (advances, flat, declines). */
@Composable
fun SplitBar(
    parts: List<Split>,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
) {
    val total = parts.sumOf { it.weight.toDouble() }.toFloat()
    if (total <= 0f) return
    Canvas(modifier.fillMaxWidth().height(height)) {
        val gap = 2.dp.toPx()
        var x = 0f
        for (part in parts) {
            val w = part.weight / total * size.width
            if (w > 0f) drawRoundRect(part.color, Offset(x, 0f), Size((w - gap).coerceAtLeast(1f), size.height), CornerRadius(size.height / 2))
            x += w
        }
    }
}

/** Where a company stands against its target: solid is now, hatched is the gap to the target, a tick marks the target. */
@Composable
fun TargetBar(
    current: Double,
    target: Double,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
) {
    val scheme = MaterialTheme.colorScheme
    val colors = SipwiseTheme.colors
    val scaleMax = max(max(current, target) * TARGET_HEADROOM, 1.0)
    Canvas(modifier.fillMaxWidth().height(height + 6.dp)) {
        val barTop = 3.dp.toPx()
        val barH = height.toPx()
        val round = CornerRadius(barH / 2)
        drawRoundRect(scheme.surfaceContainerHigh, Offset(0f, barTop), Size(size.width, barH), round)
        val now = (current / scaleMax).toFloat() * size.width
        val goal = (target / scaleMax).toFloat() * size.width
        drawRoundRect(scheme.primary, Offset(0f, barTop), Size(now.coerceAtLeast(barH), barH), round)
        if (goal > now) {
            var x = now + 2.dp.toPx()
            while (x < goal) {
                drawRect(colors.gain, Offset(x, barTop), Size(min(3.dp.toPx(), goal - x), barH))
                x += 5.dp.toPx()
            }
        }
        drawRoundRect(scheme.onSurface, Offset(goal - 1.dp.toPx(), 0f), Size(2.dp.toPx(), barH + 6.dp.toPx()), CornerRadius(1.dp.toPx()))
    }
}

private const val TARGET_HEADROOM = 1.15
