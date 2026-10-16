package app.sipwise.designsystem

/**
 * Sipwise "after dark" colour tokens as plain ARGB ints, so the contrast of every text pair can be unit tested without
 * Compose. Values are documented in plans/android-ui-redesign.md section 3.1; the web uses the same brand blue and mint.
 */
data class Palette(
    val primary: Int,
    val onPrimary: Int,
    val primaryContainer: Int,
    val onPrimaryContainer: Int,
    val secondary: Int,
    val onSecondary: Int,
    val secondaryContainer: Int,
    val onSecondaryContainer: Int,
    val tertiary: Int,
    val onTertiary: Int,
    val tertiaryContainer: Int,
    val onTertiaryContainer: Int,
    val error: Int,
    val onError: Int,
    val errorContainer: Int,
    val onErrorContainer: Int,
    val surface: Int,
    val onSurface: Int,
    val onSurfaceVariant: Int,
    val surfaceContainerLowest: Int,
    val surfaceContainerLow: Int,
    val surfaceContainer: Int,
    val surfaceContainerHigh: Int,
    val surfaceContainerHighest: Int,
    val outline: Int,
    val outlineVariant: Int,
    val inverseSurface: Int,
    val inverseOnSurface: Int,
    val inversePrimary: Int,
    // Meaning-carrying colours: never replaced by dynamic colour.
    val gain: Int,
    val gainContainer: Int,
    val loss: Int,
    val lossContainer: Int,
    val warn: Int,
    val warnContainer: Int,
    val assetStocks: Int,
    val assetFunds: Int,
    val assetGold: Int,
    val assetSilver: Int,
    val assetPlans: Int,
)

val LightPalette =
    Palette(
        primary = 0xFF1D4ED8.toInt(),
        onPrimary = 0xFFFFFFFF.toInt(),
        primaryContainer = 0xFFDCE6FF.toInt(),
        onPrimaryContainer = 0xFF0A2A7A.toInt(),
        secondary = 0xFF4F5B76.toInt(),
        onSecondary = 0xFFFFFFFF.toInt(),
        secondaryContainer = 0xFFD7E2FF.toInt(),
        onSecondaryContainer = 0xFF0B1A36.toInt(),
        tertiary = 0xFF006C4E.toInt(),
        onTertiary = 0xFFFFFFFF.toInt(),
        tertiaryContainer = 0xFFA6F2D2.toInt(),
        onTertiaryContainer = 0xFF002116.toInt(),
        error = 0xFFC42B43.toInt(),
        onError = 0xFFFFFFFF.toInt(),
        errorContainer = 0xFFFCE6EA.toInt(),
        onErrorContainer = 0xFF5C0F1A.toInt(),
        surface = 0xFFF4F6FB.toInt(),
        onSurface = 0xFF0B1430.toInt(),
        onSurfaceVariant = 0xFF52607E.toInt(),
        surfaceContainerLowest = 0xFFFFFFFF.toInt(),
        surfaceContainerLow = 0xFFFAFBFE.toInt(),
        surfaceContainer = 0xFFEEF2F9.toInt(),
        surfaceContainerHigh = 0xFFE3E9F4.toInt(),
        surfaceContainerHighest = 0xFFDCE3EF.toInt(),
        outline = 0xFF7A86A3.toInt(),
        outlineVariant = 0xFFDCE3EF.toInt(),
        inverseSurface = 0xFF18213D.toInt(),
        inverseOnSurface = 0xFFEEF1F8.toInt(),
        inversePrimary = 0xFFB4C7FF.toInt(),
        gain = 0xFF067A54.toInt(),
        gainContainer = 0xFFDDF5EB.toInt(),
        loss = 0xFFC42B43.toInt(),
        lossContainer = 0xFFFCE6EA.toInt(),
        warn = 0xFF94600A.toInt(),
        warnContainer = 0xFFFBF0D9.toInt(),
        assetStocks = 0xFF2563EB.toInt(),
        assetFunds = 0xFF7C3AED.toInt(),
        assetGold = 0xFFB7791F.toInt(),
        assetSilver = 0xFF64748B.toInt(),
        assetPlans = 0xFF0D9488.toInt(),
    )

val DarkPalette =
    Palette(
        primary = 0xFF6EA2FF.toInt(),
        onPrimary = 0xFF071233.toInt(),
        primaryContainer = 0xFF16306F.toInt(),
        onPrimaryContainer = 0xFFDCE6FF.toInt(),
        secondary = 0xFFB9C6E6.toInt(),
        onSecondary = 0xFF22304B.toInt(),
        secondaryContainer = 0xFF39465F.toInt(),
        onSecondaryContainer = 0xFFD7E2FF.toInt(),
        tertiary = 0xFF5FDDAA.toInt(),
        onTertiary = 0xFF003826.toInt(),
        tertiaryContainer = 0xFF00513A.toInt(),
        onTertiaryContainer = 0xFFA6F2D2.toInt(),
        error = 0xFFFF6F86.toInt(),
        onError = 0xFF4A0010.toInt(),
        errorContainer = 0xFF5A1426.toInt(),
        onErrorContainer = 0xFFFFDAD6.toInt(),
        surface = 0xFF070B18.toInt(),
        onSurface = 0xFFE8EEFA.toInt(),
        onSurfaceVariant = 0xFF95A2BF.toInt(),
        surfaceContainerLowest = 0xFF050813.toInt(),
        surfaceContainerLow = 0xFF0D1428.toInt(),
        surfaceContainer = 0xFF131C36.toInt(),
        surfaceContainerHigh = 0xFF1A2546.toInt(),
        surfaceContainerHighest = 0xFF222E55.toInt(),
        outline = 0xFF6B7899.toInt(),
        outlineVariant = 0xFF202B4B.toInt(),
        inverseSurface = 0xFFE8EEFA.toInt(),
        inverseOnSurface = 0xFF0B1430.toInt(),
        inversePrimary = 0xFF1D4ED8.toInt(),
        gain = 0xFF2EE6A6.toInt(),
        gainContainer = 0xFF0F2F2B.toInt(),
        loss = 0xFFFF6F86.toInt(),
        lossContainer = 0xFF3A1522.toInt(),
        warn = 0xFFF5B942.toInt(),
        warnContainer = 0xFF33280F.toInt(),
        assetStocks = 0xFF3B82F6.toInt(),
        assetFunds = 0xFFA78BFA.toInt(),
        assetGold = 0xFFF5B942.toInt(),
        assetSilver = 0xFFCBD5E1.toInt(),
        assetPlans = 0xFF2DD4BF.toInt(),
    )

/** Every foreground/background pair the UI draws text with. Each must reach WCAG AA (4.5:1). */
val TextPairs: List<Pair<(Palette) -> Int, (Palette) -> Int>> =
    listOf(
        Palette::onSurface to Palette::surface,
        Palette::onSurface to Palette::surfaceContainerLow,
        Palette::onSurface to Palette::surfaceContainerHigh,
        Palette::onSurfaceVariant to Palette::surface,
        Palette::onSurfaceVariant to Palette::surfaceContainerLow,
        Palette::onSurfaceVariant to Palette::surfaceContainerHigh,
        Palette::primary to Palette::surface,
        Palette::primary to Palette::surfaceContainerLowest,
        Palette::onPrimary to Palette::primary,
        Palette::onPrimaryContainer to Palette::primaryContainer,
        Palette::onSecondary to Palette::secondary,
        Palette::onSecondaryContainer to Palette::secondaryContainer,
        Palette::onTertiary to Palette::tertiary,
        Palette::onTertiaryContainer to Palette::tertiaryContainer,
        Palette::onError to Palette::error,
        Palette::onErrorContainer to Palette::errorContainer,
        Palette::inverseOnSurface to Palette::inverseSurface,
        Palette::gain to Palette::surface,
        Palette::gain to Palette::gainContainer,
        Palette::loss to Palette::surface,
        Palette::loss to Palette::lossContainer,
        Palette::warn to Palette::surface,
        Palette::warn to Palette::warnContainer,
    )

/** Non-text pairs (control outlines against the surfaces they sit on) that need 3:1. */
val NonTextPairs: List<Pair<(Palette) -> Int, (Palette) -> Int>> =
    listOf(
        Palette::outline to Palette::surface,
        Palette::outline to Palette::surfaceContainerLowest,
    )

private fun channel(value: Int): Double {
    val v = value / 255.0
    return if (v <= 0.03928) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of an ARGB int (alpha ignored). */
fun luminance(argb: Int): Double =
    0.2126 * channel((argb shr 16) and 0xff) + 0.7152 * channel((argb shr 8) and 0xff) + 0.0722 * channel(argb and 0xff)

/** WCAG contrast ratio of two colours (1 to 21). */
fun contrast(
    a: Int,
    b: Int,
): Double {
    val (hi, lo) = listOf(luminance(a), luminance(b)).sortedDescending()
    return (hi + 0.05) / (lo + 0.05)
}
