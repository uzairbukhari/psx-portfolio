package app.sipwise.designsystem

/**
 * Sipwise Steps colour tokens as plain ARGB ints, so the contrast of every text pair can be unit tested without
 * Compose. Values are documented in plans/native-android-rewrite.md section 4.1; the web uses the same brand blue.
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

val LightPalette = Palette(
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
    error = 0xFFB42318.toInt(),
    onError = 0xFFFFFFFF.toInt(),
    errorContainer = 0xFFFDE8E6.toInt(),
    onErrorContainer = 0xFF5C0F0A.toInt(),
    surface = 0xFFF7F8FC.toInt(),
    onSurface = 0xFF0F1A2E.toInt(),
    onSurfaceVariant = 0xFF4A5670.toInt(),
    surfaceContainerLowest = 0xFFFFFFFF.toInt(),
    surfaceContainerLow = 0xFFF2F4FA.toInt(),
    surfaceContainer = 0xFFECEFF6.toInt(),
    surfaceContainerHigh = 0xFFE6EAF2.toInt(),
    surfaceContainerHighest = 0xFFE0E5EE.toInt(),
    outline = 0xFF737E95.toInt(),
    outlineVariant = 0xFFC6CDDB.toInt(),
    inverseSurface = 0xFF253047.toInt(),
    inverseOnSurface = 0xFFEEF1F8.toInt(),
    inversePrimary = 0xFFB4C7FF.toInt(),
    gain = 0xFF0A7350.toInt(),
    gainContainer = 0xFFDCF3EA.toInt(),
    loss = 0xFFB42318.toInt(),
    lossContainer = 0xFFFDE8E6.toInt(),
    warn = 0xFF8A5A00.toInt(),
    warnContainer = 0xFFFBF0D9.toInt(),
    assetStocks = 0xFF2563EB.toInt(),
    assetFunds = 0xFF7C3AED.toInt(),
    assetGold = 0xFFB7791F.toInt(),
    assetSilver = 0xFF64748B.toInt(),
    assetPlans = 0xFF0D9488.toInt(),
)

val DarkPalette = Palette(
    primary = 0xFFA9C1FF.toInt(),
    onPrimary = 0xFF0A2A7A.toInt(),
    primaryContainer = 0xFF1F3E9E.toInt(),
    onPrimaryContainer = 0xFFDCE6FF.toInt(),
    secondary = 0xFFB9C6E6.toInt(),
    onSecondary = 0xFF22304B.toInt(),
    secondaryContainer = 0xFF39465F.toInt(),
    onSecondaryContainer = 0xFFD7E2FF.toInt(),
    tertiary = 0xFF5FDDAA.toInt(),
    onTertiary = 0xFF003826.toInt(),
    tertiaryContainer = 0xFF00513A.toInt(),
    onTertiaryContainer = 0xFFA6F2D2.toInt(),
    error = 0xFFFFB4AB.toInt(),
    onError = 0xFF690005.toInt(),
    errorContainer = 0xFF93000A.toInt(),
    onErrorContainer = 0xFFFFDAD6.toInt(),
    surface = 0xFF0B1120.toInt(),
    onSurface = 0xFFE3E8F4.toInt(),
    onSurfaceVariant = 0xFFB5BFD3.toInt(),
    surfaceContainerLowest = 0xFF070C18.toInt(),
    surfaceContainerLow = 0xFF121A2B.toInt(),
    surfaceContainer = 0xFF161F31.toInt(),
    surfaceContainerHigh = 0xFF1E2739.toInt(),
    surfaceContainerHighest = 0xFF283144.toInt(),
    outline = 0xFF8590A6.toInt(),
    outlineVariant = 0xFF3A4458.toInt(),
    inverseSurface = 0xFFE3E8F4.toInt(),
    inverseOnSurface = 0xFF253047.toInt(),
    inversePrimary = 0xFF1D4ED8.toInt(),
    gain = 0xFF4ADBA2.toInt(),
    gainContainer = 0xFF0E3427.toInt(),
    loss = 0xFFFF8A80.toInt(),
    lossContainer = 0xFF3E1714.toInt(),
    warn = 0xFFF0C46A.toInt(),
    warnContainer = 0xFF33280F.toInt(),
    assetStocks = 0xFF3B82F6.toInt(),
    assetFunds = 0xFFA78BFA.toInt(),
    assetGold = 0xFFF5B942.toInt(),
    assetSilver = 0xFFCBD5E1.toInt(),
    assetPlans = 0xFF2DD4BF.toInt(),
)

/** Every foreground/background pair the UI draws text with. Each must reach WCAG AA (4.5:1). */
val TextPairs: List<Pair<(Palette) -> Int, (Palette) -> Int>> = listOf(
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
val NonTextPairs: List<Pair<(Palette) -> Int, (Palette) -> Int>> = listOf(
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
fun contrast(a: Int, b: Int): Double {
    val (hi, lo) = listOf(luminance(a), luminance(b)).sortedDescending()
    return (hi + 0.05) / (lo + 0.05)
}
