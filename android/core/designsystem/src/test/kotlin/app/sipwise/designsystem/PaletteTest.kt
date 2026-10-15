package app.sipwise.designsystem

import kotlin.test.Test
import kotlin.test.assertTrue

class PaletteTest {
    private fun check(name: String, palette: Palette) {
        for ((fg, bg) in TextPairs) {
            val ratio = contrast(fg(palette), bg(palette))
            assertTrue(ratio >= 4.5, "$name text pair ${"%08X".format(fg(palette))} on ${"%08X".format(bg(palette))} is $ratio:1")
        }
        for ((fg, bg) in NonTextPairs) {
            val ratio = contrast(fg(palette), bg(palette))
            assertTrue(ratio >= 3.0, "$name outline is $ratio:1")
        }
    }

    @Test
    fun `light palette meets WCAG AA`() = check("light", LightPalette)

    @Test
    fun `dark palette meets WCAG AA`() = check("dark", DarkPalette)
}
