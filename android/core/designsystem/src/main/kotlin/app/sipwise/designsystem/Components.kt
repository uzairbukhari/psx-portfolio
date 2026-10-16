package app.sipwise.designsystem

import android.provider.Settings
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Card
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The night slab is dark in both themes, so its ink colours are fixed. */
object SlabColors {
    val top = Color(0xFF0E1A3F)
    val bottom = Color(0xFF0A1230)
    val ink = Color(0xFFE8EEFA)
    val muted = Color(0xFF9FB0D6)
    val gain = Color(0xFF2EE6A6)
    val loss = Color(0xFFFF6F86)
    val glowBlue = Color(0x593B82F6)
    val glowMint = Color(0x3822E0A0)
    val track = Color(0x24FFFFFF)
}

/** The brand gradient used by primary buttons, progress and the active step. */
object BrandColors {
    val blue = Color(0xFF3B82F6)
    val blueDeep = Color(0xFF1D4ED8)
    val sky = Color(0xFF6EA2FF)
    val mint = Color(0xFF22E0A0)
    val progress = Brush.linearGradient(listOf(sky, mint))
    val button = Brush.linearGradient(listOf(Color(0xFF4C8DFF), blueDeep))
}

/** True when the phone's animation scale is not zero ("Remove animations" turns every motion in the app off). */
@Composable
fun rememberMotionEnabled(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f }
}

@Composable
private fun isDarkSurface() = MaterialTheme.colorScheme.surface.luminance() < DARK_LUMINANCE

private const val DARK_LUMINANCE = 0.5f

/** The one card every screen uses: a hairline outline in dark mode, a soft shadow in light mode. */
@Composable
fun SipwiseCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    colors: CardColors? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val dark = isDarkSurface()
    val resolved =
        colors ?: CardDefaults.cardColors(
            containerColor = if (dark) scheme.surfaceContainerLow else scheme.surfaceContainerLowest,
            contentColor = scheme.onSurface,
        )
    val border = if (dark) BorderStroke(1.dp, scheme.outlineVariant) else null
    val elevation = CardDefaults.cardElevation(defaultElevation = if (dark) 0.dp else 1.dp)
    if (onClick != null) {
        Card(onClick = onClick, modifier = modifier, colors = resolved, border = border, elevation = elevation, content = content)
    } else {
        Card(modifier = modifier, colors = resolved, border = border, elevation = elevation, content = content)
    }
}

/** A dark panel with a soft blue and mint glow that holds a screen's key number and chart. */
@Composable
fun NightSlab(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = MaterialTheme.shapes.extraLarge
    CompositionLocalProvider(LocalContentColor provides SlabColors.ink) {
        Column(
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(Brush.verticalGradient(listOf(SlabColors.top, SlabColors.bottom)))
                .drawBehind {
                    drawRect(Brush.radialGradient(listOf(SlabColors.glowBlue, Color.Transparent), Offset.Zero, size.width * GLOW_RADIUS))
                    drawRect(Brush.radialGradient(listOf(SlabColors.glowMint, Color.Transparent), Offset(size.width, 0f), size.width * GLOW_RADIUS))
                }.border(1.dp, Color.White.copy(alpha = SLAB_EDGE_ALPHA), shape)
                .padding(Spacing.lg + 2.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

private const val GLOW_RADIUS = 0.8f
private const val SLAB_EDGE_ALPHA = 0.06f

/** A small caps label above a value: "NET WORTH". */
@Composable
fun Overline(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
) {
    Text(
        text.uppercase(),
        modifier = modifier,
        style = MaterialTheme.typography.labelMedium,
        color = if (color == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else color,
        maxLines = 1,
    )
}

private const val RS_SCALE = 0.62f

/** A money or percentage figure in Geist Mono; the "Rs" in front is smaller and softer so the digits carry the weight. */
@Composable
fun MoneyText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = SipwiseNumbers.medium,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    maxLines: Int = 1,
) {
    val base = if (color == Color.Unspecified) LocalContentColor.current else color
    val rs = text.indexOf("Rs")
    val annotated =
        buildAnnotatedString {
            if (rs < 0) {
                append(text)
            } else {
                append(text.substring(0, rs))
                val prefixEnd = (rs + 3).coerceAtMost(text.length)
                withStyle(SpanStyle(fontSize = style.fontSize * RS_SCALE, color = base.copy(alpha = RS_ALPHA), fontWeight = FontWeight.Medium)) {
                    append(text.substring(rs, prefixEnd))
                }
                append(text.substring(prefixEnd))
            }
        }
    Text(annotated, modifier = modifier, style = style.copy(color = base), textAlign = textAlign, maxLines = maxLines)
}

private const val RS_ALPHA = 0.7f

/** A rounded value with an arrow, tinted gain, loss or neutral. The arrow means the colour is never the only cue. */
@Composable
fun DeltaPill(
    text: String,
    positive: Boolean?,
    modifier: Modifier = Modifier,
    onSlab: Boolean = false,
) {
    val colors = SipwiseTheme.colors
    val tone =
        when {
            positive == null -> if (onSlab) SlabColors.muted else MaterialTheme.colorScheme.onSurfaceVariant
            positive -> if (onSlab) SlabColors.gain else colors.gain
            else -> if (onSlab) SlabColors.loss else colors.loss
        }
    val arrow =
        when (positive) {
            true -> "▲ "
            false -> "▼ "
            null -> ""
        }
    Box(modifier.clip(CircleShape).background(tone.copy(alpha = PILL_ALPHA)).padding(horizontal = 8.dp, vertical = 4.dp)) {
        Text(arrow + text, style = SipwiseNumbers.tiny, color = tone, maxLines = 1)
    }
}

private const val PILL_ALPHA = 0.14f

private val TileColors =
    listOf(0xFF2563EB, 0xFFB45309, 0xFF0F8A6A, 0xFF7C3AED, 0xFFC2410C, 0xFF0E7490, 0xFFBE185D, 0xFF4D7C0F).map { Color(it) }

/** A ticker monogram on a colour that comes from its sector, so rows scan by colour as well as by name. */
@Composable
fun TickerTile(
    ticker: String,
    modifier: Modifier = Modifier,
    sector: String? = null,
    size: Dp = 40.dp,
) {
    val color = TileColors[Math.floorMod((sector ?: ticker).hashCode(), TileColors.size)]
    Box(modifier.size(size).clip(RoundedCornerShape(size * TILE_RADIUS)).background(color), contentAlignment = Alignment.Center) {
        Text(ticker.take(TILE_LETTERS), style = SipwiseNumbers.tiny.copy(fontSize = (size.value * TILE_FONT).sp), color = Color.White, maxLines = 1)
    }
}

private const val TILE_RADIUS = 0.33f
private const val TILE_FONT = 0.26f
private const val TILE_LETTERS = 4

/** A rounded square with an icon, tinted with [tint] at low strength. */
@Composable
fun IconTile(
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
) {
    Box(modifier.size(size).clip(RoundedCornerShape(size * TILE_RADIUS)).background(tint.copy(alpha = PILL_ALPHA)), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * ICON_SHARE))
    }
}

private const val ICON_SHARE = 0.5f

/** A one-row choice of a few options (ranges, sorts, tabs). */
@Composable
fun <T> SegmentedControl(
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    onSlab: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    val track = if (onSlab) Color.White.copy(alpha = SEGMENT_SLAB_ALPHA) else scheme.surfaceContainerHigh
    val thumb = if (onSlab) Color.White.copy(alpha = SEGMENT_THUMB_ALPHA) else scheme.surface
    val ink = if (onSlab) SlabColors.ink else scheme.onSurface
    val quiet = if (onSlab) SlabColors.muted else scheme.onSurfaceVariant
    Row(modifier.fillMaxWidth().clip(CircleShape).background(track).padding(3.dp)) {
        for (option in options) {
            val on = option == selected
            Box(
                Modifier
                    .weight(1f)
                    .clip(CircleShape)
                    .background(if (on) thumb else Color.Transparent)
                    .selectable(selected = on, role = Role.Tab, onClick = { onSelect(option) })
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label(option), style = MaterialTheme.typography.labelLarge, color = if (on) ink else quiet, maxLines = 1)
            }
        }
    }
}

private const val SEGMENT_SLAB_ALPHA = 0.07f
private const val SEGMENT_THUMB_ALPHA = 0.14f

/** A label over a figure, for the 2x2 stat grids. */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = Color.Unspecified,
) {
    SipwiseCard(modifier) {
        Column(Modifier.padding(horizontal = Spacing.md + 2.dp, vertical = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm - 2.dp)) {
            Overline(label)
            MoneyText(value, style = SipwiseNumbers.medium, color = valueColor)
        }
    }
}

/** A title and a figure on the right, for key-value lines. */
@Composable
fun ValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = Color.Unspecified,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        MoneyText(value, style = SipwiseNumbers.small, color = valueColor)
    }
}

/** A list row: icon or tile on the left, two lines of text, something on the right. */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(vertical = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        trailing?.invoke()
    }
}

/** A grey placeholder shape that breathes while a screen loads, in the size of the thing that will replace it. */
@Composable
fun SkeletonBlock(
    modifier: Modifier = Modifier,
    shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(12.dp),
) {
    val alpha =
        if (rememberMotionEnabled()) {
            rememberInfiniteTransition(label = "skeleton")
                .animateFloat(
                    initialValue = SKELETON_LOW,
                    targetValue = SKELETON_HIGH,
                    animationSpec = infiniteRepeatable(tween(SKELETON_MS), RepeatMode.Reverse),
                    label = "skeleton-alpha",
                ).value
        } else {
            SKELETON_HIGH
        }
    Box(modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = alpha)))
}

private const val SKELETON_LOW = 0.45f
private const val SKELETON_HIGH = 0.9f
private const val SKELETON_MS = 900

/** The logo: the monthly steps with the mint dot. [reveal] sweeps the steps in from the left, [dot] scales the dot in. */
@Composable
fun StepsMark(
    modifier: Modifier = Modifier,
    tint: Color = Color.White,
    dotColor: Color = BrandColors.mint,
    reveal: Float = 1f,
    dot: Float = 1f,
) {
    Canvas(modifier) {
        val scale = minOf(size.width / MARK_W, size.height / MARK_H)
        val dx = (size.width - MARK_W * scale) / 2
        val dy = (size.height - MARK_H * scale) / 2

        fun p(
            x: Float,
            y: Float,
        ) = Offset(dx + (x - MARK_X) * scale, dy + (y - MARK_Y) * scale)
        val steps =
            Path().apply {
                val points =
                    listOf(
                        30f to 72f, 42f to 72f, 42f to 60f, 54f to 60f, 54f to 48f, 66f to 48f, 66f to 36f, 78f to 36f,
                        78f to 44f, 70f to 44f, 70f to 56f, 58f to 56f, 58f to 68f, 46f to 68f, 46f to 80f, 30f to 80f,
                    )
                points.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(p(x, y).x, p(x, y).y) else lineTo(p(x, y).x, p(x, y).y) }
                close()
            }
        clipRect(right = size.width * reveal.coerceIn(0f, 1f)) { drawPath(steps, tint) }
        if (dot > 0f) drawCircle(dotColor, MARK_DOT * scale * dot.coerceIn(0f, 1.2f), p(MARK_DOT_X, MARK_DOT_Y))
    }
}

private const val MARK_X = 26f
private const val MARK_Y = 22f
private const val MARK_W = 58f
private const val MARK_H = 62f
private const val MARK_DOT = 5f
private const val MARK_DOT_X = 72f
private const val MARK_DOT_Y = 30f

/** Nothing here yet: the logo steps, a line of explanation and an optional action. */
@Composable
fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    action: @Composable (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StepsMark(Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outlineVariant)
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

/** One destination in the floating bar. */
data class NavItemSpec(
    val label: String,
    val icon: ImageVector,
    val selected: Boolean,
    val onClick: () -> Unit,
)

/** Four destinations around a raised add button, floating above the gesture area. */
@Composable
fun FloatingNavBar(
    left: List<NavItemSpec>,
    right: List<NavItemSpec>,
    addDescription: String,
    onAdd: () -> Unit,
    modifier: Modifier = Modifier,
    showAdd: Boolean = true,
) {
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(NAV_RADIUS.dp)
    Row(
        modifier
            .padding(horizontal = Spacing.md, vertical = Spacing.sm)
            .fillMaxWidth()
            .clip(shape)
            .background(scheme.surfaceContainerLow.copy(alpha = NAV_ALPHA))
            .border(1.dp, scheme.outlineVariant, shape)
            .padding(horizontal = Spacing.xs, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceAround,
    ) {
        for (item in left) NavItem(item, Modifier.weight(1f))
        if (showAdd) {
            Box(
                Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(ADD_RADIUS.dp))
                    .background(BrandColors.button)
                    .clickable(onClickLabel = addDescription, onClick = onAdd),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Add, contentDescription = addDescription, tint = Color.White)
            }
        }
        for (item in right) NavItem(item, Modifier.weight(1f))
    }
}

private const val NAV_RADIUS = 26
private const val ADD_RADIUS = 18
private const val NAV_ALPHA = 0.94f

@Composable
private fun NavItem(
    item: NavItemSpec,
    modifier: Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val tone = if (item.selected) scheme.onSurface else scheme.onSurfaceVariant
    Column(
        modifier.selectable(selected = item.selected, role = Role.Tab, onClick = item.onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(
            Modifier.clip(CircleShape).background(if (item.selected) scheme.surfaceContainerHigh else Color.Transparent).padding(horizontal = 14.dp, vertical = 3.dp),
        ) {
            Icon(item.icon, contentDescription = null, tint = tone, modifier = Modifier.size(22.dp))
        }
        Text(item.label, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp), color = tone, maxLines = 1)
    }
}

/** A screen-sized placeholder: used while a view model has nothing to show yet. */
@Composable
fun ScreenSkeleton(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SkeletonBlock(Modifier.fillMaxWidth().height(210.dp), RoundedCornerShape(28.dp))
        SkeletonBlock(Modifier.fillMaxWidth().height(96.dp), RoundedCornerShape(24.dp))
        SkeletonBlock(Modifier.fillMaxWidth().height(140.dp), RoundedCornerShape(24.dp))
    }
}

