package app.sipwise.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.provider.Settings
import androidx.core.net.toUri
import app.sipwise.BuildConfig
import app.sipwise.network.ApiJson
import app.sipwise.network.AvailableUpdate
import app.sipwise.network.GithubRelease
import app.sipwise.network.expectedSha256
import app.sipwise.network.findUpdate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class UpdateException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Checks GitHub Releases for a newer build, downloads it, verifies its SHA-256 and hands it to the system installer. */
class UpdateManager(private val context: Context, private val http: OkHttpClient = OkHttpClient()) {
    private val apkPrefix = if (BuildConfig.INCLUDE_PRERELEASES) "sipwise-staging" else "sipwise"

    /** [includePrereleases] lets one signed-in account (the owner) test builds before they are promoted. */
    suspend fun check(includePrereleases: Boolean = false): AvailableUpdate? =
        withContext(Dispatchers.IO) {
            val body = fetchText("https://api.github.com/repos/${BuildConfig.UPDATE_REPO}/releases?per_page=20")
            val releases = ApiJson.decodeFromString(ListSerializer(GithubRelease.serializer()), body)
            findUpdate(releases, BuildConfig.VERSION_NAME, BuildConfig.TAG_PREFIX, apkPrefix, BuildConfig.INCLUDE_PRERELEASES || includePrereleases)
        }

    /** Downloads the APK and returns it only if its hash matches the release's SHA256SUMS. */
    suspend fun download(
        update: AvailableUpdate,
        onProgress: (Float) -> Unit,
    ): File =
        withContext(Dispatchers.IO) {
            val sumsUrl = update.sumsUrl ?: throw UpdateException("This release has no checksum file, so it was not installed.")
            val expected =
                expectedSha256(fetchText(sumsUrl), update.apkName)
                    ?: throw UpdateException("The checksum file does not list ${update.apkName}.")
            val dir = File(context.cacheDir, UPDATE_DIR).apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val target = File(dir, update.apkName)
            val digest = MessageDigest.getInstance("SHA-256")
            try {
                http.newCall(Request.Builder().url(update.apkUrl).build()).execute().use { response ->
                    if (!response.isSuccessful) throw UpdateException("The download failed (${response.code}).")
                    val body = response.body ?: throw UpdateException("The download was empty.")
                    val total = body.contentLength().takeIf { it > 0 } ?: update.sizeBytes
                    var read = 0L
                    body.byteStream().use { input ->
                        target.outputStream().use { out ->
                            val buffer = ByteArray(BUFFER)
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                out.write(buffer, 0, n)
                                digest.update(buffer, 0, n)
                                read += n
                                if (total > 0) onProgress((read.toFloat() / total).coerceIn(0f, 1f))
                            }
                        }
                    }
                }
            } catch (e: IOException) {
                target.delete()
                throw UpdateException("The download failed. Check your connection and try again.", e)
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != expected) {
                target.delete()
                throw UpdateException("The downloaded file did not match its checksum, so it was discarded.")
            }
            target
        }

    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Opens the system screen where the person lets this app install updates. */
    fun permissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input -> session.openWrite("update", 0, apk.length()).use { out -> input.copyTo(out).also { session.fsync(out) } } }
            val intent = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            session.commit(pending.intentSender)
        }
    }

    private fun fetchText(url: String): String {
        try {
            http.newCall(Request.Builder().url(url).header("Accept", "application/vnd.github+json").build()).execute().use { response ->
                if (!response.isSuccessful) throw UpdateException("Could not check for updates (${response.code}).")
                return response.body?.string() ?: throw UpdateException("Could not check for updates.")
            }
        } catch (e: IOException) {
            throw UpdateException("Could not check for updates. Check your connection.", e)
        }
    }

    private companion object {
        const val UPDATE_DIR = "updates"
        const val BUFFER = 64 * 1024
    }
}

/** Receives the installer's status: shows the system confirmation when it is needed. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(context::startActivity)
        }
    }
}
