package app.sipwise.crash

import android.content.Context
import android.os.Build
import app.sipwise.BuildConfig
import app.sipwise.analytics.Analytics
import app.sipwise.network.Events
import java.io.File
import java.time.Instant

private const val CRASH_DIR = "crashes"
private const val KEEP_REPORTS = 5
private const val MAX_MESSAGE = 160
private const val MAX_FRAMES = 40
private const val SENT_SUFFIX = ".sent"

/**
 * Writes a plain-text report when the app crashes, so the cause can be read afterwards (More > Crash report) instead of
 * guessed. It holds the exception class, a trimmed message and the stack, the app and Android version and the screen the
 * person was on. Messages from the JSON reader are left out because they can quote the data being read. Nothing leaves
 * the phone except the closed `app / uncaught` error the audit log already counts (and only when usage stats are on).
 */
class CrashReporter(context: Context) {
    private val dir = File(context.filesDir, CRASH_DIR)

    @Volatile var screen: String = "today"

    fun install() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { write(thread, error) }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun write(
        thread: Thread,
        error: Throwable,
    ) {
        dir.mkdirs()
        val now = Instant.now()
        File(dir, "crash-${now.toEpochMilli()}.txt").writeText(report(now, thread, error))
        prune()
    }

    private fun report(
        at: Instant,
        thread: Thread,
        error: Throwable,
    ): String =
        buildString {
            appendLine("Sipwise ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), $at")
            appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("Screen: $screen, thread: ${thread.name}")
            var current: Throwable? = error
            var depth = 0
            while (current != null && depth < MAX_CAUSES) {
                appendLine()
                appendLine(if (depth == 0) describe(current) else "Caused by: ${describe(current)}")
                current.stackTrace.take(MAX_FRAMES).forEach { appendLine("    at $it") }
                current = current.cause
                depth++
            }
        }

    private fun describe(error: Throwable): String {
        val name = error.javaClass.name
        val quotesData = name.startsWith("kotlinx.serialization") || error is IllegalArgumentException && error.message.orEmpty().contains("JSON")
        val message = if (quotesData) null else error.message?.take(MAX_MESSAGE)
        return if (message.isNullOrBlank()) name else "$name: $message"
    }

    private fun prune() {
        dir.listFiles { file -> file.name.startsWith("crash-") }?.sortedByDescending { it.name }?.drop(KEEP_REPORTS)?.forEach { it.delete() }
    }

    /** The newest report, or null when the app has not crashed since the reports were cleared. */
    fun latest(): String? = files().firstOrNull()?.readText()

    private fun files(): List<File> = dir.listFiles { file -> file.name.startsWith("crash-") }?.sortedByDescending { it.name }.orEmpty()

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** Counts each crash once in the audit log (area app, code uncaught) the next time the app opens signed in. */
    fun reportPending(analytics: Analytics) {
        for (file in files().filter { it.name.endsWith(".txt") }) {
            val screen = file.readLines().firstOrNull { it.startsWith("Screen: ") }?.removePrefix("Screen: ")?.substringBefore(',').orEmpty()
            analytics.track(Events.CLIENT_ERROR, "area" to "app", "code" to "uncaught", "screen" to screen.ifBlank { "today" })
            file.renameTo(File(file.parentFile, file.name + SENT_SUFFIX))
        }
    }
}

private const val MAX_CAUSES = 4
