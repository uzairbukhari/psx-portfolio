package app.sipwise.designsystem

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Colours that carry meaning (gain, loss, warning, asset classes). Dynamic colour never replaces them. */
@Immutable
data class SipwiseColors(
    val gain: Color,
    val gainContainer: Color,
    val loss: Color,
    val lossContainer: Color,
    val warn: Color,
    val warnContainer: Color,
    val assetStocks: Color,
    val assetFunds: Color,
    val assetGold: Color,
    val assetSilver: Color,
    val assetPlans: Color,
)

val LocalSipwiseColors = staticCompositionLocalOf { sipwiseColors(LightPalette) }

private fun sipwiseColors(p: Palette) =
    SipwiseColors(
        gain = Color(p.gain),
        gainContainer = Color(p.gainContainer),
        loss = Color(p.loss),
        lossContainer = Color(p.lossContainer),
        warn = Color(p.warn),
        warnContainer = Color(p.warnContainer),
        assetStocks = Color(p.assetStocks),
        assetFunds = Color(p.assetFunds),
        assetGold = Color(p.assetGold),
        assetSilver = Color(p.assetSilver),
        assetPlans = Color(p.assetPlans),
    )

private fun Palette.lightScheme() =
    lightColorScheme(
        primary = Color(primary), onPrimary = Color(onPrimary),
        primaryContainer = Color(primaryContainer), onPrimaryContainer = Color(onPrimaryContainer),
        secondary = Color(secondary), onSecondary = Color(onSecondary),
        secondaryContainer = Color(secondaryContainer), onSecondaryContainer = Color(onSecondaryContainer),
        tertiary = Color(tertiary), onTertiary = Color(onTertiary),
        tertiaryContainer = Color(tertiaryContainer), onTertiaryContainer = Color(onTertiaryContainer),
        error = Color(error), onError = Color(onError),
        errorContainer = Color(errorContainer), onErrorContainer = Color(onErrorContainer),
        background = Color(surface), onBackground = Color(onSurface),
        surface = Color(surface), onSurface = Color(onSurface), onSurfaceVariant = Color(onSurfaceVariant),
        surfaceContainerLowest = Color(surfaceContainerLowest), surfaceContainerLow = Color(surfaceContainerLow),
        surfaceContainer = Color(surfaceContainer), surfaceContainerHigh = Color(surfaceContainerHigh),
        surfaceContainerHighest = Color(surfaceContainerHighest),
        outline = Color(outline), outlineVariant = Color(outlineVariant),
        inverseSurface = Color(inverseSurface), inverseOnSurface = Color(inverseOnSurface), inversePrimary = Color(inversePrimary),
    )

private fun Palette.darkScheme() =
    darkColorScheme(
        primary = Color(primary), onPrimary = Color(onPrimary),
        primaryContainer = Color(primaryContainer), onPrimaryContainer = Color(onPrimaryContainer),
        secondary = Color(secondary), onSecondary = Color(onSecondary),
        secondaryContainer = Color(secondaryContainer), onSecondaryContainer = Color(onSecondaryContainer),
        tertiary = Color(tertiary), onTertiary = Color(onTertiary),
        tertiaryContainer = Color(tertiaryContainer), onTertiaryContainer = Color(onTertiaryContainer),
        error = Color(error), onError = Color(onError),
        errorContainer = Color(errorContainer), onErrorContainer = Color(onErrorContainer),
        background = Color(surface), onBackground = Color(onSurface),
        surface = Color(surface), onSurface = Color(onSurface), onSurfaceVariant = Color(onSurfaceVariant),
        surfaceContainerLowest = Color(surfaceContainerLowest), surfaceContainerLow = Color(surfaceContainerLow),
        surfaceContainer = Color(surfaceContainer), surfaceContainerHigh = Color(surfaceContainerHigh),
        surfaceContainerHighest = Color(surfaceContainerHighest),
        outline = Color(outline), outlineVariant = Color(outlineVariant),
        inverseSurface = Color(inverseSurface), inverseOnSurface = Color(inverseOnSurface), inversePrimary = Color(inversePrimary),
    )

/** Tabular figures so digits never shift as a value changes. */
private const val TABULAR = "tnum"
private val GeistFamily =
    FontFamily(
        Font(R.font.geist_regular, FontWeight.Normal),
        Font(R.font.geist_medium, FontWeight.Medium),
        Font(R.font.geist_semibold, FontWeight.SemiBold),
    )

/** Geist Mono carries every money figure and percentage, so numbers read like a ledger. */
val GeistMonoFamily =
    FontFamily(
        Font(R.font.geist_mono_medium, FontWeight.Normal),
        Font(R.font.geist_mono_medium, FontWeight.Medium),
        Font(R.font.geist_mono_semibold, FontWeight.SemiBold),
    )

private fun style(
    size: Int,
    line: Int,
    weight: FontWeight,
    spacing: Double = 0.0,
    mono: Boolean = false,
) =
    TextStyle(
        fontFamily = if (mono) GeistMonoFamily else GeistFamily,
        fontSize = size.sp,
        lineHeight = line.sp,
        fontWeight = weight,
        letterSpacing = spacing.sp,
        fontFeatureSettings = if (mono) TABULAR else null,
    )

val SipwiseTypography =
    Typography(
        displayMedium = style(40, 44, FontWeight.SemiBold, -1.2, mono = true),
        displaySmall = style(32, 36, FontWeight.SemiBold, -1.0, mono = true),
        headlineMedium = style(28, 34, FontWeight.SemiBold, -0.3),
        headlineSmall = style(22, 28, FontWeight.SemiBold, -0.2),
        titleLarge = style(20, 26, FontWeight.SemiBold, -0.1),
        titleMedium = style(15, 20, FontWeight.SemiBold),
        titleSmall = style(14, 20, FontWeight.SemiBold),
        bodyLarge = style(16, 24, FontWeight.Normal),
        bodyMedium = style(14, 20, FontWeight.Normal),
        bodySmall = style(12, 17, FontWeight.Normal),
        labelLarge = style(13, 18, FontWeight.SemiBold, 0.1),
        labelMedium = style(11, 14, FontWeight.SemiBold, 1.0),
        labelSmall = style(10, 14, FontWeight.SemiBold, 0.8),
    )

/** Money, percentages and other figures: Geist Mono, tabular. */
object SipwiseNumbers {
    val hero = style(34, 38, FontWeight.SemiBold, -1.4, mono = true)
    val large = style(26, 32, FontWeight.SemiBold, -1.0, mono = true)
    val medium = style(17, 24, FontWeight.SemiBold, -0.4, mono = true)
    val small = style(13, 18, FontWeight.Medium, -0.2, mono = true)
    val tiny = style(11, 14, FontWeight.Medium, -0.1, mono = true)
}

val SipwiseShapes =
    Shapes(
        extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        small = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
        large = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
        extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(28.dp),
    )

/** The 4 dp spacing scale. */
object Spacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val gutter = 16.dp
}

object SipwiseTheme {
    val colors: SipwiseColors
        @Composable
        @ReadOnlyComposable
        get() = LocalSipwiseColors.current

    val chart: ChartColors
        @Composable
        @ReadOnlyComposable
        get() = LocalChartColors.current
}

@Composable
fun SipwiseTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    chartPalette: ChartPalette = ChartPalette.CLASSIC,
    content: @Composable () -> Unit,
) {
    val palette = if (darkTheme) DarkPalette else LightPalette
    val scheme: ColorScheme =
        when {
            dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                if (darkTheme) dynamicDarkColorScheme(LocalContext.current) else dynamicLightColorScheme(LocalContext.current)
            darkTheme -> palette.darkScheme()
            else -> palette.lightScheme()
        }
    CompositionLocalProvider(
        LocalSipwiseColors provides sipwiseColors(palette),
        LocalChartColors provides chartColors(chartPalette, darkTheme),
    ) {
        MaterialTheme(colorScheme = scheme, typography = SipwiseTypography, shapes = SipwiseShapes, content = content)
    }
}
