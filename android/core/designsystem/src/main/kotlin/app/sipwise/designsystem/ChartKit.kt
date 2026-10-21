package app.sipwise.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.sipwise.model.compactAxis
import app.sipwise.model.cumulative
import app.sipwise.model.niceTicks
import app.sipwise.model.slotAt
import app.sipwise.model.stackLayers
import kotlin.math.max

/** One bar: its label under the axis, the value drawn, and an optional ghost bar behind it (the plan). */
data class ChartBar(
    val label: String,
    val value: Double,
    val ghost: Double? = null,
    val color: Color? = null,
)

/** One layer of a [StackedAreaChart] or one line of a [ComboChart], with the words for its legend chip. */
data class ChartLayer(
    val label: String,
    val points: List<List<Double>>,
    val color: Color,
    val dashed: Boolean = false,
)

private const val BAR_ANIM_MS = 420
private const val BAR_GAP_FRACTION = 0.34f
private const val GHOST_ALPHA = 0.22f
private const val PICKED_ALPHA = 1f
private const val DIM_ALPHA = 0.45f
private const val AXIS_ROOM = 18
private const val VALUE_ROOM = 20
private const val MIN_TOUCH = 48

/**
 * Bars with their labels under the axis: dividends by month, money in, a month's plan against what went in. Tap a
 * bar to pin its value above it; the pinned bar is also what TalkBack reads. A [ChartBar.ghost] draws the planned
 * amount faintly behind the real one, so "half done" is visible without a second chart.
 */
@Composable
fun BarChart(
    bars: List<ChartBar>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 150.dp,
    onSlab: Boolean = false,
    color: Color = MaterialTheme.colorScheme.primary,
    valueLabel: (Double) -> String = ::compactAxis,
    table: ChartTable? = null,
    onShowTable: ((ChartTable) -> Unit)? = null,
) {
    if (bars.isEmpty()) return
    val ink = chartInk(onSlab)
    val measurer = rememberTextMeasurer()
    val haptic = LocalHapticFeedback.current
    val motion = rememberMotionEnabled()
    val progress = remember { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(bars) {
        if (motion) {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(BAR_ANIM_MS))
        }
    }
    var picked by remember(bars) { mutableIntStateOf(-1) }
    val top = max(bars.maxOf { max(it.value, it.ghost ?: 0.0) }, 1.0)
    val spoken =
        if (picked >= 0) {
            "${bars[picked].label}, ${valueLabel(bars[picked].value)}"
        } else {
            "$description. ${bars.size} bars, highest ${valueLabel(top)}. Tap a bar for its value."
        }
    var sheet by remember { mutableStateOf(false) }
    val actions = tableActions(table, onShowTable) { sheet = true }
    Box {
        Canvas(
            modifier
                .fillMaxWidth()
                .height(max(height.value, MIN_TOUCH.toFloat()).dp)
                .semantics {
                    contentDescription = spoken
                    if (actions.isNotEmpty()) customActions = actions
                }
                .pointerInput(bars) {
                    detectTapGestures { tap ->
                        val index = slotAt(tap.x, size.width.toFloat(), bars.size)
                        picked = if (index == picked) -1 else index
                        if (picked >= 0) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    }
                },
        ) {
            val axis = AXIS_ROOM.dp.toPx()
            val room = VALUE_ROOM.dp.toPx()
            val floor = size.height - axis
            val slot = size.width / bars.size
            val barWidth = slot * (1f - BAR_GAP_FRACTION)
            val radius = CornerRadius(3.dp.toPx(), 3.dp.toPx())
            drawLine(ink.grid, Offset(0f, floor), Offset(size.width, floor), 1.dp.toPx())
            bars.forEachIndexed { i, bar ->
                val left = slot * i + (slot - barWidth) / 2f
                val fill = bar.color ?: color
                bar.ghost?.let { ghost ->
                    val h = ((ghost / top).toFloat() * (floor - room)).coerceAtLeast(0f)
                    drawRoundRect(fill.copy(alpha = GHOST_ALPHA), Offset(left, floor - h), Size(barWidth, h), radius)
                }
                val h = ((bar.value / top).toFloat() * (floor - room) * progress.value).coerceAtLeast(0f)
                val alpha = if (picked < 0 || picked == i) PICKED_ALPHA else DIM_ALPHA
                drawRoundRect(fill.copy(alpha = alpha), Offset(left, floor - h), Size(barWidth, h), radius)
                val label = measurer.measure(bar.label, ink.labelStyle)
                if (label.size.width <= slot) {
                    drawText(measurer, bar.label, Offset(slot * i + (slot - label.size.width) / 2f, floor + 3.dp.toPx()), ink.labelStyle)
                }
                if (picked == i) {
                    val text = valueLabel(bar.value)
                    val layout = measurer.measure(text, ink.bubbleStyle)
                    val x = (slot * i + (slot - layout.size.width) / 2f - 6.dp.toPx()).coerceIn(0f, size.width - layout.size.width - 12.dp.toPx())
                    tag(measurer, text, Offset(x, (floor - h - layout.size.height - 10.dp.toPx()).coerceAtLeast(0f)), ink.bubble, ink.bubbleStyle, 6.dp.toPx())
                }
            }
        }
    }
    if (sheet && table != null) ChartTableSheet(table) { sheet = false }
}

/** The "Show as table" action a chart offers TalkBack: the host's sheet when it has one, otherwise the chart's own. */
@Composable
internal fun tableActions(
    table: ChartTable?,
    onShowTable: ((ChartTable) -> Unit)?,
    openOwn: () -> Unit,
): List<CustomAccessibilityAction> =
    remember(table, onShowTable) {
        if (table == null) {
            emptyList()
        } else {
            listOf(
                CustomAccessibilityAction("Show as table") {
                    if (onShowTable != null) onShowTable(table) else openOwn()
                    true
                },
            )
        }
    }

/**
 * Bars on the left scale with a line on the right: each dividend payment with the running total over it, or money in
 * per month with the total so far. Two scales, so a small payment is still visible beside a large total.
 */
@Composable
fun ComboChart(
    bars: List<ChartBar>,
    lineLabel: String,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 170.dp,
    onSlab: Boolean = false,
    barColor: Color = MaterialTheme.colorScheme.primary,
    lineColor: Color = MaterialTheme.colorScheme.secondary,
    line: List<Double> = cumulative(bars.map { it.value }),
    valueLabel: (Double) -> String = ::compactAxis,
    table: ChartTable? = null,
    onShowTable: ((ChartTable) -> Unit)? = null,
) {
    if (bars.isEmpty()) return
    val ink = chartInk(onSlab)
    val measurer = rememberTextMeasurer()
    var picked by remember(bars) { mutableIntStateOf(-1) }
    val barTop = max(bars.maxOf { it.value }, 1.0)
    val lineTop = max(line.maxOrNull() ?: 1.0, 1.0)
    val spoken =
        if (picked >= 0) {
            "${bars[picked].label}, ${valueLabel(bars[picked].value)}, $lineLabel ${valueLabel(line.getOrElse(picked) { 0.0 })}"
        } else {
            "$description. $lineLabel reaches ${valueLabel(lineTop)}."
        }
    var sheet by remember { mutableStateOf(false) }
    val actions = tableActions(table, onShowTable) { sheet = true }
    Box {
        Column {
            Canvas(
                modifier
                    .fillMaxWidth()
                    .height(height)
                    .semantics {
                        contentDescription = spoken
                        if (actions.isNotEmpty()) customActions = actions
                    }
                    .pointerInput(bars) {
                        detectTapGestures { tap ->
                            val index = slotAt(tap.x, size.width.toFloat(), bars.size)
                            picked = if (index == picked) -1 else index
                        }
                    },
            ) {
                drawCombo(
                    ComboPaint(bars, line, barTop, lineTop, picked, barColor, lineColor, ink, measurer, valueLabel),
                )
            }
            ChartLegend(
                listOf(ChartLayer("Each payment", emptyList(), barColor), ChartLayer(lineLabel, emptyList(), lineColor)),
                onSlab = onSlab,
            )
        }
    }
    if (sheet && table != null) ChartTableSheet(table) { sheet = false }
}

/**
 * Layers stacked on one scale: what the SIP projection is made of, or value against money in. Tapping a legend chip
 * hides that layer, so one part can be read on its own.
 */
@Composable
fun StackedAreaChart(
    layers: List<ChartLayer>,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 180.dp,
    onSlab: Boolean = false,
    xLabel: (Double) -> String = { "" },
    yLabel: (Double) -> String = ::compactAxis,
    markers: List<LabelledMarker> = emptyList(),
    table: ChartTable? = null,
    onShowTable: ((ChartTable) -> Unit)? = null,
) {
    if (layers.isEmpty()) return
    var hidden by remember(layers) { mutableStateOf(emptySet<String>()) }
    val shown = layers.filter { it.label !in hidden }
    val tops = remember(shown) { stackLayers(shown.map { it.points }) }
    val series =
        tops
            .mapIndexed { i, points -> ChartSeries(points = points, color = shown[i].color, fill = true, dashed = shown[i].dashed) }
            .reversed()
    Column(modifier) {
        TimeSeriesChart(
            series = series,
            description = description,
            height = height,
            onSlab = onSlab,
            zoomable = false,
            xLabel = xLabel,
            yLabel = yLabel,
            markers = markers,
            scrubDetail = { _, ys -> ys.firstOrNull()?.let(yLabel).orEmpty() },
            table = table,
            onShowTable = onShowTable,
        )
        ChartLegend(layers, hidden, onSlab) { label ->
            // The last visible layer cannot be hidden, so a chart is never left empty.
            hidden =
                when {
                    label in hidden -> hidden - label
                    hidden.size + 1 < layers.size -> hidden + label
                    else -> hidden
                }
        }
    }
}

/** Legend chips under a chart; with [onToggle] a tap hides or shows that layer. */
@Composable
fun ChartLegend(
    layers: List<ChartLayer>,
    hidden: Set<String> = emptySet(),
    onSlab: Boolean = false,
    onToggle: ((String) -> Unit)? = null,
) {
    val muted = if (onSlab) SlabColors.muted else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.padding(top = 8.dp).fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        for (layer in layers) {
            val off = layer.label in hidden
            Row(
                Modifier
                    .then(if (onToggle == null) Modifier else Modifier.pointerInput(layer.label) { detectTapGestures { onToggle(layer.label) } })
                    .semantics { contentDescription = "${layer.label}${if (off) ", hidden" else ""}" },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    Modifier
                        .size(9.dp)
                        .background(if (off) Color.Transparent else layer.color, CircleShape)
                        .border(1.dp, layer.color, CircleShape),
                )
                Text(layer.label, style = MaterialTheme.typography.labelSmall, color = if (off) muted.copy(alpha = DIM_ALPHA) else muted)
            }
        }
    }
}

/** One class of a mix bar: the share it takes and the words TalkBack reads for it. */
data class MixSegment(
    val label: String,
    val share: Double,
    val color: Color,
)

/**
 * The asset mix as one bar: stocks, funds, gold, currency side by side. Each segment names itself for TalkBack, so
 * the mix can be read without seeing the colours.
 */
@Composable
fun MixBar(
    segments: List<MixSegment>,
    modifier: Modifier = Modifier,
    height: Dp = 14.dp,
    labels: Boolean = true,
    onSlab: Boolean = false,
) {
    val total = segments.sumOf { it.share }
    if (total <= 0.0) return
    val spoken = segments.filter { it.share > 0 }.joinToString(", ") { "${it.label} ${(it.share / total * 100).toInt()}%" }
    Column(modifier.semantics { contentDescription = spoken }) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(height)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(height / 2)),
        ) {
            for (segment in segments) {
                if (segment.share <= 0.0) continue
                Box(
                    Modifier
                        .weight((segment.share / total).toFloat())
                        .fillMaxWidth()
                        .height(height)
                        .background(segment.color),
                )
            }
        }
        if (labels) {
            Spacer(Modifier.height(8.dp))
            ChartLegend(
                segments.map { ChartLayer("${it.label} ${(it.share / total * 100).toInt()}%", emptyList(), it.color) },
                onSlab = onSlab,
            )
        }
    }
}

/** How one month of the SIP went. The shape differs as well as the colour, so the strip reads without colour. */
enum class HabitState(val wire: String) {
    MET("met"),
    PARTIAL("partial"),
    MISSED("missed"),
    CURRENT("current"),
    BEFORE("before"),
    ;

    companion object {
        fun parse(value: String): HabitState = entries.firstOrNull { it.wire == value } ?: BEFORE
    }
}

/** One square of the habit strip. */
data class HabitSquare(val month: String, val state: HabitState, val detail: String = "")

private const val HABIT_SIZE = 20
private const val HABIT_PARTIAL_ALPHA = 0.45f
private const val HABIT_BEFORE_ALPHA = 0.12f

/**
 * The SIP habit: one square per month, filled when the month met its target, half-filled when it was close, hollow
 * when it was missed and a dashed outline for the month still running.
 */
@Composable
fun HabitStrip(
    squares: List<HabitSquare>,
    modifier: Modifier = Modifier,
    onSlab: Boolean = false,
    met: Color = MaterialTheme.colorScheme.primary,
    missed: Color = MaterialTheme.colorScheme.outline,
) {
    if (squares.isEmpty()) return
    val spoken =
        squares.joinToString(", ") { "${it.month} ${it.state.wire}" }.let { "SIP habit: $it" }
    var picked by remember(squares) { mutableStateOf<HabitSquare?>(null) }
    val muted = if (onSlab) SlabColors.muted else MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier.semantics { contentDescription = spoken }) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height((HABIT_SIZE + 8).dp)
                .pointerInput(squares) {
                    detectTapGestures { tap ->
                        val index = slotAt(tap.x, size.width.toFloat(), squares.size)
                        picked = if (index < 0 || squares.getOrNull(index) == picked) null else squares[index]
                    }
                },
        ) {
            val slot = size.width / squares.size
            val side = minOf(HABIT_SIZE.dp.toPx(), slot - 4.dp.toPx())
            val radius = CornerRadius(5.dp.toPx(), 5.dp.toPx())
            val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))
            squares.forEachIndexed { i, square ->
                val at = Offset(slot * i + (slot - side) / 2f, (size.height - side) / 2f)
                val box = Size(side, side)
                when (square.state) {
                    HabitState.MET -> drawRoundRect(met, at, box, radius)
                    HabitState.PARTIAL -> {
                        drawRoundRect(met.copy(alpha = HABIT_PARTIAL_ALPHA), at, box, radius)
                        drawRoundRect(met, at, box, radius, style = Stroke(1.5.dp.toPx()))
                    }
                    HabitState.MISSED -> drawRoundRect(missed, at, box, radius, style = Stroke(1.5.dp.toPx()))
                    HabitState.CURRENT ->
                        drawRoundRect(met, at, box, radius, style = Stroke(1.5.dp.toPx(), pathEffect = dash))
                    HabitState.BEFORE -> drawRoundRect(missed.copy(alpha = HABIT_BEFORE_ALPHA), at, box, radius)
                }
            }
        }
        picked?.let {
            Text(
                "${it.month} · ${it.detail.ifEmpty { it.state.wire }}",
                style = MaterialTheme.typography.labelSmall,
                color = muted,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/** The rows behind a chart, for anyone who would rather read the numbers (and for TalkBack). */
@Composable
fun ChartTableSheet(
    table: ChartTable,
    onDismiss: () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Text(table.title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth()) {
                for (column in table.columns) {
                    Text(
                        column,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 6.dp))
            LazyColumn(Modifier.heightIn(max = TABLE_MAX_HEIGHT.dp)) {
                items(table.rows) { row ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        row.forEachIndexed { i, cell ->
                            Text(
                                cell,
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = if (i == 0) null else GeistMonoFamily,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
            if (table.rows.isEmpty()) {
                Text("Nothing to show yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private const val TABLE_MAX_HEIGHT = 420

/** Everything one [ComboChart] draws, gathered so the drawing is a function of its own. */
private class ComboPaint(
    val bars: List<ChartBar>,
    val line: List<Double>,
    val barTop: Double,
    val lineTop: Double,
    val picked: Int,
    val barColor: Color,
    val lineColor: Color,
    val ink: ChartInk,
    val measurer: TextMeasurer,
    val valueLabel: (Double) -> String,
)

/** The bars on the left scale, the cumulative line on the right, and the pinned bar's bubble. */
private fun DrawScope.drawCombo(p: ComboPaint) {
    val floor = size.height - AXIS_ROOM.dp.toPx()
    val room = VALUE_ROOM.dp.toPx()
    val slot = size.width / p.bars.size
    val barWidth = slot * (1f - BAR_GAP_FRACTION)
    val radius = CornerRadius(3.dp.toPx(), 3.dp.toPx())
    val dash = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))
    for (tick in niceTicks(0.0, p.lineTop, GRID_LINES)) {
        val y = floor - (tick / p.lineTop).toFloat() * (floor - room)
        if (y >= 0f) drawLine(p.ink.grid, Offset(0f, y), Offset(size.width, y), 1.dp.toPx(), pathEffect = dash)
    }
    drawLine(p.ink.grid, Offset(0f, floor), Offset(size.width, floor), 1.dp.toPx())
    p.bars.forEachIndexed { i, bar ->
        val left = slot * i + (slot - barWidth) / 2f
        val h = ((bar.value / p.barTop).toFloat() * (floor - room)).coerceAtLeast(0f)
        val alpha = if (p.picked < 0 || p.picked == i) PICKED_ALPHA else DIM_ALPHA
        drawRoundRect((bar.color ?: p.barColor).copy(alpha = alpha), Offset(left, floor - h), Size(barWidth, h), radius)
        val label = p.measurer.measure(bar.label, p.ink.labelStyle)
        if (label.size.width <= slot) {
            drawText(p.measurer, bar.label, Offset(slot * i + (slot - label.size.width) / 2f, floor + 3.dp.toPx()), p.ink.labelStyle)
        }
    }
    if (p.line.size >= 2) drawCumulative(p, floor, room, slot)
    if (p.picked >= 0) {
        val text = "${p.valueLabel(p.bars[p.picked].value)} · ${p.valueLabel(p.line.getOrElse(p.picked) { 0.0 })}"
        val layout = p.measurer.measure(text, p.ink.bubbleStyle)
        val x = (slot * p.picked + slot / 2f - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width - 12.dp.toPx())
        tag(p.measurer, text, Offset(x, 0f), p.ink.bubble, p.ink.bubbleStyle, 6.dp.toPx())
    }
}

/** The running total as a line through the middle of each bar, with its last point emphasised. */
private fun DrawScope.drawCumulative(
    p: ComboPaint,
    floor: Float,
    room: Float,
    slot: Float,
) {
    val y = { value: Double -> floor - (value / p.lineTop).toFloat() * (floor - room) }
    val path =
        Path().apply {
            p.line.forEachIndexed { i, value ->
                val x = slot * i + slot / 2f
                if (i == 0) moveTo(x, y(value)) else lineTo(x, y(value))
            }
        }
    drawPath(path, p.lineColor, style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round))
    p.line.lastOrNull()?.let {
        val c = Offset(slot * (p.line.size - 1) + slot / 2f, y(it))
        drawCircle(p.lineColor.copy(alpha = DOT_HALO_ALPHA), 9.dp.toPx(), c)
        drawCircle(p.lineColor, 4.dp.toPx(), c)
    }
}

private const val GRID_LINES = 3
