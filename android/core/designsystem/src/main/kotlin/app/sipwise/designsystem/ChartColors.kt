package app.sipwise.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The web's chart palettes (`lib/chart-palette.ts`, tokens `--cat-1..7`, `--chart-up/down` in `app/redesign.css` and
 * `app/globals.css`) as plain ARGB ints, so a unit test can compare them with the web and nothing here needs Compose.
 * A per-device display choice, never saved to the vault.
 */
enum class ChartPalette(val wire: String) {
    CLASSIC("default"),
    VIBRANT("vibrant"),
    ACCESSIBLE("accessible"),
    ;

    companion object {
        fun parse(value: String?): ChartPalette = entries.firstOrNull { it.wire == value } ?: CLASSIC
    }
}

/** One palette in one theme: seven categorical colours plus the up and down colours of the charts. */
data class ChartInts(
    val cat: List<Int>,
    val up: Int,
    val down: Int,
    val other: Int,
    val neutral: Int,
    val assetFx: Int,
)

private fun ints(vararg values: Long) = values.map { it.toInt() }

private val ClassicLight =
    ChartInts(
        cat = ints(0xFF2563EB, 0xFFB45309, 0xFF0F8A6A, 0xFF7C3AED, 0xFFC2410C, 0xFF0E7490, 0xFFBE185D),
        up = 0xFF067A54.toInt(),
        down = 0xFFC42B43.toInt(),
        other = 0xFF94A3B8.toInt(),
        neutral = 0xFF64748B.toInt(),
        assetFx = 0xFF0E7490.toInt(),
    )
private val ClassicDark =
    ChartInts(
        cat = ints(0xFF5B8DEF, 0xFFE08A2E, 0xFF2BB58C, 0xFF9B7BF0, 0xFFE8743B, 0xFF2AA5C2, 0xFFE0528F),
        up = 0xFF2EE6A6.toInt(),
        down = 0xFFFF6F86.toInt(),
        other = 0xFF5B6B85.toInt(),
        neutral = 0xFF7F93B8.toInt(),
        assetFx = 0xFF22D3EE.toInt(),
    )
private val VibrantLight =
    ClassicLight.copy(
        cat = ints(0xFF1D6FFF, 0xFFFF5A1F, 0xFF00B36B, 0xFFFFA800, 0xFFE5188F, 0xFF8A2BE2, 0xFF00B8D9),
        up = 0xFF00A86B.toInt(),
        down = 0xFFFF2D55.toInt(),
    )
private val VibrantDark =
    ClassicDark.copy(
        cat = ints(0xFF4D9DFF, 0xFFFF7A3D, 0xFF19E68C, 0xFFFFC21A, 0xFFFF4DB8, 0xFFB57BFF, 0xFF22D3EE),
        up = 0xFF19F0A0.toInt(),
        down = 0xFFFF4D6D.toInt(),
    )
private val AccessibleLight =
    ClassicLight.copy(
        cat = ints(0xFF0072B2, 0xFFD55E00, 0xFF009E73, 0xFFE69F00, 0xFFCC79A7, 0xFF56B4E9, 0xFF8C7B00),
        up = 0xFF0072B2.toInt(),
        down = 0xFFD55E00.toInt(),
    )
private val AccessibleDark =
    ClassicDark.copy(
        cat = ints(0xFF4AA3E0, 0xFFFF8A33, 0xFF19C28F, 0xFFF5B82E, 0xFFE592C0, 0xFF7CC7F4, 0xFFF0E442),
        up = 0xFF56B4E9.toInt(),
        down = 0xFFFF8A33.toInt(),
    )

fun chartInts(
    palette: ChartPalette,
    dark: Boolean,
): ChartInts =
    when (palette) {
        ChartPalette.CLASSIC -> if (dark) ClassicDark else ClassicLight
        ChartPalette.VIBRANT -> if (dark) VibrantDark else VibrantLight
        ChartPalette.ACCESSIBLE -> if (dark) AccessibleDark else AccessibleLight
    }

/** The chart colours of the active palette and theme. */
@Immutable
data class ChartColors(
    val cat: List<Color>,
    val up: Color,
    val down: Color,
    val other: Color,
    val neutral: Color,
    val assetFx: Color,
) {
    /** The nth categorical colour, wrapping after seven. */
    fun category(index: Int): Color = cat[Math.floorMod(index, cat.size)]
}

fun chartColors(
    palette: ChartPalette,
    dark: Boolean,
): ChartColors {
    val c = chartInts(palette, dark)
    return ChartColors(c.cat.map { Color(it) }, Color(c.up), Color(c.down), Color(c.other), Color(c.neutral), Color(c.assetFx))
}

val LocalChartColors = staticCompositionLocalOf { chartColors(ChartPalette.CLASSIC, dark = false) }
