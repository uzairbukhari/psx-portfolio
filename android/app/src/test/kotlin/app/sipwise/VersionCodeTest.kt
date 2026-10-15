package app.sipwise

import kotlin.test.Test
import kotlin.test.assertTrue

/** The version-code formula lives in app/build.gradle.kts; this documents and pins its ordering rules. */
class VersionCodeTest {
    private fun code(
        major: Int,
        minor: Int,
        patch: Int,
        rc: Int = 0,
    ): Int {
        val slot = if (rc > 0) (rc - 1).coerceAtMost(8) else 9
        return major * 100_000 + minor * 1_000 + patch * 10 + slot
    }

    @Test
    fun `codes always increase with the version`() {
        assertTrue(code(1, 0, 1) > code(1, 0, 0))
        assertTrue(code(1, 1, 0) > code(1, 0, 99))
        assertTrue(code(2, 0, 0) > code(1, 99, 99))
    }

    @Test
    fun `a release candidate sorts below its final release and above the previous release`() {
        assertTrue(code(1, 2, 0, rc = 1) < code(1, 2, 0))
        assertTrue(code(1, 2, 0, rc = 2) > code(1, 2, 0, rc = 1))
        assertTrue(code(1, 2, 0, rc = 1) > code(1, 1, 99))
    }

    @Test
    fun `the first native release is above any Expo build counter`() {
        assertTrue(code(1, 0, 0) > 100_000)
    }
}
