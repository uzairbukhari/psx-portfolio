package app.sipwise.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sipwise.model.ZoomWindow
import app.sipwise.model.compactAxis
import app.sipwise.model.nearestIndex
import app.sipwise.model.paddedRange
import app.sipwise.model.trend
import app.sipwise.model.valueAt
import app.sipwise.model.visiblePoints
import kotlin.math.abs

/**
 * A dot on a [TimeSeriesChart] with words of its own: a buy or a sale on the price chart, or a milestone on a
 * projection. [up] draws a triangle pointing up and down draws one pointing down, so the two read apart without
 * colour; a null [up] draws a plain dot.
 */
data class LabelledMarker(
    val x: Double,
    val y: Double,
    val color: Color,
    val label: String,
    val up: Boolean? = null,
)

/** The rows behind a chart, for the "Show as table" sheet and for TalkBack. */
data class ChartTable(
    val title: String,
    val columns: List<String>,
    val rows: List<List<String>>,
)

private const val MINI_HEIGHT = 28
private const val MINI_ALPHA = 0.35f
private const val MINI_WINDOW_ALPHA = 0.16f
private const val MARKER_HIT_DP = 22
private const val DOUBLE_TAP_ZOOM = 3f
private const val TWO_FINGERS = 2

/**
 * The company and value chart: everything [AreaChart] draws, plus pinch zoom, two-finger pan, double tap to reset,
 * a mini-map strip showing where the window sits, markers that carry their own words, a spoken one-line summary and
 * a "Show as table" action for TalkBack.
 *
 * One finger scrubs, two fingers zoom and pan, so neither gesture steals the other. Zooming never asks the engine
 * for more data: the points are already loaded and the window only chooses what is drawn.
 */
@Suppress("CyclomaticComplexMethod", "LongMethod")
@Composable
fun TimeSeriesChart(
    series: List<ChartSeries>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 180.dp,
    onSlab: Boolean = false,
    showAxes: Boolean = true,
    zoomable: Boolean = true,
    xLabel: (Double) -> String = { "" },
    yLabel: (Double) -> String = ::compactAxis,
    scrubDetail: ((x: Double, ys: List<Double?>) -> String)? = null,
    references: List<ChartReference> = emptyList(),
    markers: List<LabelledMarker> = emptyList(),
    table: ChartTable? = null,
    onShowTable: ((ChartTable) -> Unit)? = null,
) {
    val full = series.flatMap { it.points }
    if (full.size < 2) return
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
    var window by remember(series) { mutableStateOf(ZoomWindow()) }
    var scrub by remember { mutableStateOf<Float?>(null) }
    var picked by remember { mutableStateOf<LabelledMarker?>(null) }
    var lastIndex by remember { mutableIntStateOf(-1) }

    val fullMinX = full.minOf { it[0] }
    val fullSpanX = (full.maxOf { it[0] } - fullMinX).takeIf { it > 0 } ?: 1.0
    val from = fullMinX + fullSpanX * window.start
    val to = fullMinX + fullSpanX * window.end
    val shown = remember(series, window) { series.map { it.copy(points = visiblePoints(it.points, from, to)) } }
    val seen = shown.flatMap { it.points }
    val (lo, hi) = paddedRange(seen.map { it[1] } + references.map { it.y })
    val xs = shown.firstOrNull { it.points.isNotEmpty() }?.points?.map { it[0] }.orEmpty()
    val axisWidth = if (showAxes) AXIS_WIDTH.dp else 0.dp
    val head = shown.firstOrNull { it.fill } ?: shown.firstOrNull()
    val move = trend(head?.points.orEmpty())
    val summary =
        buildString {
            append(description)
            if (move != null) {
                append(", ")
                append(if (move.up) "up" else "down")
                append(" ")
                append("%.1f%%".format(abs(move.percent)))
            }
            head?.points?.lastOrNull()?.let {
                append(", latest ")
                append(yLabel(it[1]))
            }
        }
    var sheet by remember { mutableStateOf(false) }
    val actions = tableActions(table, onShowTable) { sheet = true }

    Column(modifier) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height)
                .semantics {
                    contentDescription = summary
                    if (actions.isNotEmpty()) customActions = actions
                }.pointerInput(series, zoomable) {
                    val plotWidth = { size.width - axisWidth.toPx() }

                    fun scrubTo(x: Float) {
                        val fraction = (x / plotWidth()).coerceIn(0f, 1f)
                        scrub = fraction
                        val index = nearestIndex(xs, from + (to - from) * fraction)
                        if (index != lastIndex) {
                            lastIndex = index
                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        }
                    }
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var fingers = 1
                        while (true) {
                            val event = awaitPointerEvent()
                            val down = event.changes.count { it.pressed }
                            if (down == 0) break
                            fingers = maxOf(fingers, down)
                            if (zoomable && down >= TWO_FINGERS) {
                                scrub = null
                                val zoom = event.calculateZoom()
                                val pan = event.calculatePan()
                                val focus = (event.calculateCentroid().x / plotWidth()).coerceIn(0f, 1f)
                                if (zoom != 1f) window = window.zoom(zoom, focus)
                                if (pan.x != 0f) window = window.pan(-pan.x / plotWidth() * window.width)
                                event.changes.forEach { it.consume() }
                            } else if (fingers < TWO_FINGERS) {
                                val position = event.changes.firstOrNull { it.pressed }?.position ?: break
                                scrubTo(position.x)
                                event.changes.forEach { it.consume() }
                            }
                        }
                        scrub = null
                    }
                }.pointerInput(series, markers, zoomable) {
                    detectTapGestures(
                        onDoubleTap = { if (zoomable) window = ZoomWindow() },
                        onTap = { tap ->
                            val plot = plotOf(size.width - axisWidth.toPx(), size.height, from, to, lo, hi, showAxes, this)
                            val hit = MARKER_HIT_DP.dp.toPx()
                            picked =
                                markers
                                    .filter { it.x in from..to }
                                    .minByOrNull { (Offset(plot.x(it.x), plot.y(it.y)) - tap).getDistance() }
                                    ?.takeIf { (Offset(plot.x(it.x), plot.y(it.y)) - tap).getDistance() <= hit }
                        },
                    )
                },
        ) {
            val plot = plotOf(size.width - axisWidth.toPx(), size.height, from, to, lo, hi, showAxes, this)
            if (showAxes) drawAxes(plot, ink, measurer, yLabel, xLabel)
            for (ref in references) {
                val y = plot.y(ref.y)
                val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))
                drawLine(ref.color, Offset(plot.left, y), Offset(plot.right, y), 1.2.dp.toPx(), pathEffect = dash)
                tag(measurer, ref.label, Offset(plot.right + 3.dp.toPx(), y - 9.dp.toPx()), ref.color, ink.labelStyle, 5.dp.toPx())
            }
            drawSeries(plot, shown, progress.value)
            for (marker in markers) {
                if (marker.x < from || marker.x > to) continue
                drawMarker(plot, marker, marker == picked)
            }
            picked?.let { pin ->
                if (pin.x in from..to) {
                    val layout = measurer.measure(pin.label, ink.bubbleStyle)
                    val padding = 6.dp.toPx()
                    val left = (plot.x(pin.x) - layout.size.width / 2f - padding).coerceIn(0f, size.width - layout.size.width - padding * 2)
                    tag(measurer, pin.label, Offset(left, 0f), ink.bubble, ink.bubbleStyle, padding)
                }
            }
            val frac = scrub
            if (frac == null && picked == null && head != null && progress.value >= 1f) {
                head.points.lastOrNull()?.let { last ->
                    val c = Offset(plot.x(last[0]), plot.y(last[1]))
                    drawCircle(head.color.copy(alpha = DOT_HALO_ALPHA), 9.dp.toPx(), c)
                    drawCircle(head.color, 4.dp.toPx(), c)
                }
            }
            if (frac != null) {
                val dataX = from + (to - from) * frac
                val ys = shown.map { valueAt(it.points, dataX) }
                val detail = scrubDetail?.invoke(dataX, ys) ?: ys.firstOrNull()?.let(yLabel).orEmpty()
                drawScrub(plot, ink, measurer, shown, frac, xLabel(dataX), detail)
            }
        }
        if (zoomable && window.zoomed) {
            Spacer(Modifier.height(6.dp))
            MiniMap(series, window, ink) { window = it }
        }
    }
    if (sheet && table != null) ChartTableSheet(table) { sheet = false }
}

/** The strip under a zoomed chart: the whole series small, with the visible window lit and draggable. */
@Composable
private fun MiniMap(
    series: List<ChartSeries>,
    window: ZoomWindow,
    ink: ChartInk,
    onMove: (ZoomWindow) -> Unit,
) {
    val line = series.firstOrNull { it.fill } ?: series.firstOrNull() ?: return
    val points = line.points
    if (points.size < 2) return
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(MINI_HEIGHT.dp)
            .semantics { contentDescription = "Chart window. Double tap the chart to see everything again." }
            .pointerInput(points) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    var last = down.position.x
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.pressed } ?: break
                        onMove(window.pan((change.position.x - last) / size.width))
                        last = change.position.x
                        change.consume()
                    }
                }
            },
    ) {
        val minX = points.minOf { it[0] }
        val spanX = (points.maxOf { it[0] } - minX).takeIf { it > 0 } ?: 1.0
        val (lo, hi) = paddedRange(points.map { it[1] })
        val path =
            Path().apply {
                points.forEachIndexed { i, p ->
                    val x = ((p[0] - minX) / spanX).toFloat() * size.width
                    val y = (1 - ((p[1] - lo) / (hi - lo)).toFloat()) * size.height
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
            }
        drawPath(path, line.color.copy(alpha = MINI_ALPHA), style = Stroke(1.4.dp.toPx(), cap = StrokeCap.Round))
        val left = window.start * size.width
        val width = window.width * size.width
        drawRect(line.color.copy(alpha = MINI_WINDOW_ALPHA), Offset(left, 0f), androidx.compose.ui.geometry.Size(width, size.height))
        for (x in listOf(left, left + width)) drawLine(line.color, Offset(x, 0f), Offset(x, size.height), 1.5.dp.toPx())
        drawLine(ink.grid, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
    }
}

/** A buy or sale dot: a triangle when the marker says which way it went, so the two read apart without colour. */
private fun DrawScope.drawMarker(
    plot: Plot,
    marker: LabelledMarker,
    picked: Boolean,
) {
    val c = Offset(plot.x(marker.x), plot.y(marker.y))
    val r = (if (picked) 6f else 4.5f).dp.toPx()
    if (picked) drawCircle(marker.color.copy(alpha = DOT_HALO_ALPHA), r * 2.2f, c)
    when (marker.up) {
        null -> {
            drawCircle(Color.White, r + 1.5f.dp.toPx(), c)
            drawCircle(marker.color, r, c)
        }
        else -> {
            val sign = if (marker.up) -1f else 1f
            val path =
                Path().apply {
                    moveTo(c.x, c.y + sign * r)
                    lineTo(c.x - r, c.y - sign * r * 0.8f)
                    lineTo(c.x + r, c.y - sign * r * 0.8f)
                    close()
                }
            drawPath(path, marker.color)
        }
    }
}

internal const val AXIS_WIDTH = 40

/** The plot frame of a chart that fills [width] by [height] with [showAxes] deciding the room under it. */
internal fun plotOf(
    width: Float,
    height: Float,
    from: Double,
    to: Double,
    lo: Double,
    hi: Double,
    showAxes: Boolean,
    density: androidx.compose.ui.unit.Density,
): Plot =
    with(density) {
        Plot(
            left = 0f,
            right = width,
            top = BUBBLE_ROOM.dp.toPx(),
            bottom = height - (if (showAxes) X_AXIS_ROOM.dp else 4.dp).toPx(),
            minX = from,
            spanX = (to - from).takeIf { it > 0 } ?: 1.0,
            lo = lo,
            hi = hi,
        )
    }

/** The chart colours and label styles for a card or a night slab, resolved once. */
@Composable
internal fun chartInk(onSlab: Boolean): ChartInk {
    val scheme = MaterialTheme.colorScheme
    val labelColor = if (onSlab) SlabColors.muted else scheme.onSurfaceVariant
    return ChartInk(
        grid = if (onSlab) Color.White.copy(alpha = GRID_SLAB_ALPHA) else scheme.outlineVariant,
        label = labelColor,
        bubble = if (onSlab) Color(0xFFF4F7FF) else scheme.onSurface,
        surface = if (onSlab) SlabColors.bottom else scheme.surface,
        labelStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = LABEL_SP.sp, color = labelColor),
        bubbleStyle = TextStyle(fontFamily = GeistMonoFamily, fontSize = 11.sp, color = scheme.surface, fontWeight = FontWeight.Medium),
    )
}
