package app.sipwise.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ReleaseUpdatesTest {
    private fun release(
        version: String,
        prerelease: Boolean,
        draft: Boolean = false,
        apk: Boolean = true,
    ) = GithubRelease(
        tag = "android-v$version",
        prerelease = prerelease,
        draft = draft,
        body = "notes $version",
        assets =
            buildList {
                if (apk) add(ReleaseAsset("sipwise-$version.apk", "https://x/$version.apk", 10))
                add(ReleaseAsset("sipwise-staging-$version.apk", "https://x/staging-$version.apk", 11))
                add(ReleaseAsset("SHA256SUMS", "https://x/sums", 1))
            },
    )

    @Test
    fun `release candidates sort below their final release`() {
        assertTrue(AppVersion.parse("1.0.0-rc.2")!! < AppVersion.parse("1.0.0")!!)
        assertTrue(AppVersion.parse("1.0.0-rc.1")!! < AppVersion.parse("1.0.0-rc.2")!!)
        assertTrue(AppVersion.parse("1.10.0")!! > AppVersion.parse("1.9.9")!!)
        assertNull(AppVersion.parse("1.0"))
        assertNull(AppVersion.parse("v1.0.0"))
    }

    @Test
    fun `production only sees final releases and picks the newest`() {
        val releases = listOf(release("1.1.0-rc.1", true), release("1.0.1", false), release("1.0.2", false, draft = true), release("0.9.0", false))
        val update = findUpdate(releases, "1.0.0", "android-v", "sipwise", includePrereleases = false)
        assertNotNull(update)
        assertEquals("1.0.1", update.version)
        assertEquals("https://x/1.0.1.apk", update.apkUrl)
        assertEquals("https://x/sums", update.sumsUrl)
    }

    @Test
    fun `staging also sees pre-releases and uses the staging file`() {
        val releases = listOf(release("1.1.0-rc.1", true), release("1.0.1", false))
        val update = findUpdate(releases, "1.0.1", "android-v", "sipwise-staging", includePrereleases = true)
        assertEquals("1.1.0-rc.1", update?.version)
        assertEquals("sipwise-staging-1.1.0-rc.1.apk", update?.apkName)
    }

    @Test
    fun `nothing newer, a missing apk, or a foreign tag offers nothing`() {
        assertNull(findUpdate(listOf(release("1.0.0", false)), "1.0.0", "android-v", "sipwise", false))
        assertNull(findUpdate(listOf(release("1.0.1", false, apk = false)), "1.0.0", "android-v", "sipwise", false))
        val foreign = release("9.0.0", false).copy(tag = "web-v9.0.0")
        assertNull(findUpdate(listOf(foreign), "1.0.0", "android-v", "sipwise", false))
        assertNull(findUpdate(listOf(release("1.0.1", false)), "0.0.1-dev", "android-v", "sipwise", false))
    }

    @Test
    fun `expected hash is read from sha256sum output`() {
        val sums = "ABCDEF01  sipwise-1.0.1.apk\n0123  *sipwise-staging-1.0.1.apk\n"
        assertEquals("abcdef01", expectedSha256(sums, "sipwise-1.0.1.apk"))
        assertEquals("0123", expectedSha256(sums, "sipwise-staging-1.0.1.apk"))
        assertNull(expectedSha256(sums, "other.apk"))
    }
}
