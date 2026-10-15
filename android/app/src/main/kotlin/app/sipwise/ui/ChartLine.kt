package app.sipwise.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.sipwise.designsystem.Spacing

/** One line on a [MultiLineChart]: points are [x, y] pairs. */
data class ChartLine(val points: List<List<Double>>, val color: Color, val dashed: Boolean = false)

/** Lines on a shared scale (the shared TypeScript has already cut them to the chosen range). */
@Composable
fun MultiLineChart(
    lines: List<ChartLine>,
    description: String,
    modifier: Modifier = Modifier,
) {
    val all = lines.flatMap { it.points }
    if (all.size < 2) return
    val minX = all.minOf { it[0] }
    val spanX = (all.maxOf { it[0] } - minX).takeIf { it > 0 } ?: 1.0
    val minY = all.minOf { it[1] }
    val spanY = (all.maxOf { it[1] } - minY).takeIf { it > 0 } ?: 1.0
    val axis = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(CHART_HEIGHT).semantics { contentDescription = description }) {
        for (line in lines) {
            val path = Path()
            line.points.forEachIndexed { i, p ->
                val x = ((p[0] - minX) / spanX * size.width).toFloat()
                val y = size.height - ((p[1] - minY) / spanY * size.height).toFloat()
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            val effect = if (line.dashed) PathEffect.dashPathEffect(floatArrayOf(DASH, DASH)) else null
            drawPath(path, line.color, style = Stroke(width = LINE_WIDTH.dp.toPx(), pathEffect = effect))
        }
        drawLine(axis, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1.dp.toPx())
    }
}

/** A colour swatch followed by what the line means. */
@Composable
fun LegendRow(
    color: Color,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(LEGEND_SIZE)) { drawCircle(color) }
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

private val CHART_HEIGHT = 160.dp
private val LEGEND_SIZE = 10.dp
private const val LINE_WIDTH = 2.5f
private const val DASH = 12f
