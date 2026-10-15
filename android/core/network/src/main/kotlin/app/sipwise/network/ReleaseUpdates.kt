package app.sipwise.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ReleaseAsset(
    val name: String,
    @SerialName("browser_download_url") val url: String,
    val size: Long = 0,
)

@Serializable
data class GithubRelease(
    @SerialName("tag_name") val tag: String,
    val prerelease: Boolean = false,
    val draft: Boolean = false,
    val body: String? = null,
    val assets: List<ReleaseAsset> = emptyList(),
)

/** A newer build the person can install. [sha256] comes from the release's SHA256SUMS file, not from the APK host. */
data class AvailableUpdate(
    val version: String,
    val notes: String,
    val apkUrl: String,
    val apkName: String,
    val sizeBytes: Long,
    val sumsUrl: String?,
)

/** `1.2.3` or `1.2.3-rc.4`. A release candidate sorts below its final release. */
data class AppVersion(val major: Int, val minor: Int, val patch: Int, val rc: Int?) : Comparable<AppVersion> {
    override fun compareTo(other: AppVersion): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch }, { it.rc ?: Int.MAX_VALUE })

    companion object {
        private val pattern = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$""")

        fun parse(text: String): AppVersion? {
            val m = pattern.matchEntire(text.trim()) ?: return null
            val g = m.groupValues
            return AppVersion(g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toIntOrNull())
        }
    }
}

/**
 * Picks the newest installable release for this build. [apkPrefix] is `sipwise` for production and
 * `sipwise-staging` for staging; pre-releases are only offered when [includePrereleases] is set.
 */
fun findUpdate(
    releases: List<GithubRelease>,
    installedVersion: String,
    tagPrefix: String,
    apkPrefix: String,
    includePrereleases: Boolean,
): AvailableUpdate? {
    val installed = AppVersion.parse(installedVersion) ?: return null
    val candidates =
        releases
            .asSequence()
            .filter { !it.draft && (includePrereleases || !it.prerelease) && it.tag.startsWith(tagPrefix) }
            .mapNotNull { release ->
                val version = AppVersion.parse(release.tag.removePrefix(tagPrefix)) ?: return@mapNotNull null
                val apk = release.assets.firstOrNull { it.name == "$apkPrefix-${release.tag.removePrefix(tagPrefix)}.apk" }
                if (apk == null || version <= installed) null else Triple(version, release, apk)
            }
    val best = candidates.maxByOrNull { it.first } ?: return null
    val (_, release, apk) = best
    return AvailableUpdate(
        version = release.tag.removePrefix(tagPrefix),
        notes = release.body.orEmpty(),
        apkUrl = apk.url,
        apkName = apk.name,
        sizeBytes = apk.size,
        sumsUrl = release.assets.firstOrNull { it.name == "SHA256SUMS" }?.url,
    )
}

/** Reads the expected hash of [fileName] from `sha256sum` output (`<hex>  <name>` per line). */
fun expectedSha256(
    sums: String,
    fileName: String,
): String? =
    sums.lineSequence()
        .map { it.trim().split(Regex("""\s+"""), limit = 2) }
        .firstOrNull { it.size == 2 && it[1].trimStart('*') == fileName }
        ?.get(0)
        ?.lowercase()
