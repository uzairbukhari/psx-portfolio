package app.sipwise.crash

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.edit
import app.sipwise.BuildConfig
import app.sipwise.analytics.Analytics
import app.sipwise.network.Events
import app.sipwise.session.EngineFailures
import java.io.File
import java.time.Instant

private const val CRASH_DIR = "crashes"
private const val KEEP_REPORTS = 5
private const val MAX_MESSAGE = 160
private const val MAX_FRAMES = 40
private const val SENT_SUFFIX = ".sent"
private const val HANDLED = "-handled"
private const val STATE_FILE = "crash_state"
private const val LAST_EXIT = "last_exit"
private const val EXIT_LOOKBACK = 5
private const val MAX_TRACE_LINES = 40
private const val KB_PER_MB = 1024

/** Only the endings that point at a fault; a normal exit, a swipe away or a permission change is not a crash. */
@RequiresApi(Build.VERSION_CODES.R)
private fun systemExits() =
    setOf(
        ApplicationExitInfo.REASON_CRASH_NATIVE,
        ApplicationExitInfo.REASON_ANR,
        ApplicationExitInfo.REASON_LOW_MEMORY,
        ApplicationExitInfo.REASON_SIGNALED,
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE,
        ApplicationExitInfo.REASON_DEPENDENCY_DIED,
    )

/**
 * Writes a plain-text report when the app crashes, so the cause can be read afterwards (More > Crash report) instead of
 * guessed. It holds the exception class, a trimmed message and the stack, the app and Android version and the screen the
 * person was on. Messages from the JSON reader are left out because they can quote the data being read. Nothing leaves
 * the phone except the closed `app / uncaught` error the audit log already counts (and only when usage stats are on).
 */
class CrashReporter(private val context: Context) {
    private val dir = File(context.filesDir, CRASH_DIR)
    private val state = context.getSharedPreferences(STATE_FILE, Context.MODE_PRIVATE)

    @Volatile var screen: String = "today"

    fun install() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { write(thread, error) }
            previous?.uncaughtException(thread, error)
        }
        EngineFailures.sink = { where, error -> handled(where, error) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Thread { runCatching { recordSystemExits() } }.start()
    }

    /** A failure the app survived (a screen that could not read its data, the engine stopping); kept so it can be read in More. */
    fun handled(
        where: String,
        error: Throwable,
    ) {
        runCatching {
            dir.mkdirs()
            val now = Instant.now()
            File(dir, "crash-${now.toEpochMilli()}$HANDLED.txt").writeText("Handled: $where\n" + report(now, Thread.currentThread(), error))
            prune()
        }
    }

    /**
     * Android's own record of how the last runs of the app ended. A Java crash is already written above; this adds the ones
     * that leave no exception behind (native crash, out of memory, the system stopping a stuck app), with Android's wording.
     */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun recordSystemExits() {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val seen = state.getLong(LAST_EXIT, 0L)
        val exits = manager.getHistoricalProcessExitReasons(context.packageName, 0, EXIT_LOOKBACK).filter { it.timestamp > seen }
        for (exit in exits.sortedBy { it.timestamp }) {
            if (exit.reason !in systemExits()) continue
            dir.mkdirs()
            val trace = if (exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) exit.traceInputStream?.bufferedReader()?.useLines { it.take(MAX_TRACE_LINES).toList() }.orEmpty() else emptyList()
            val text =
                buildString {
                    appendLine("Handled: system-exit")
                    appendLine("Sipwise ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), ${Instant.ofEpochMilli(exit.timestamp)}")
                    appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
                    appendLine("Screen: $screen, thread: system")
                    appendLine()
                    appendLine("Android ended the app: ${exitName(exit.reason)} (status ${exit.status}), ${exit.description.orEmpty()}")
                    appendLine("Was in the ${if (exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE) "foreground" else "background"}, memory ${exit.pss / KB_PER_MB} MB")
                    trace.forEach { appendLine("    $it") }
                }
            File(dir, "crash-${exit.timestamp}-exit.txt").writeText(text)
        }
        exits.maxOfOrNull { it.timestamp }?.let { state.edit { putLong(LAST_EXIT, it) } }
        prune()
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun exitName(reason: Int) =
        when (reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "native crash"
            ApplicationExitInfo.REASON_ANR -> "not responding"
            ApplicationExitInfo.REASON_LOW_MEMORY -> "out of memory"
            ApplicationExitInfo.REASON_SIGNALED -> "killed by a signal"
            ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "used too many resources"
            ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "failed to start"
            ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "a service it needs stopped"
            else -> "reason $reason"
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
        // JSON reader messages end with the text they were reading; keep only the part that names the field and the problem.
        val message = (if (quotesData) error.message?.substringBefore("JSON input") else error.message)?.take(MAX_MESSAGE)
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
        for (file in files().filter { it.name.endsWith(".txt") && !it.name.contains(HANDLED) && !it.name.contains("-exit") }) {
            val screen = file.readLines().firstOrNull { it.startsWith("Screen: ") }?.removePrefix("Screen: ")?.substringBefore(',').orEmpty()
            analytics.track(Events.CLIENT_ERROR, "area" to "app", "code" to "uncaught", "screen" to screen.ifBlank { "today" })
            file.renameTo(File(file.parentFile, file.name + SENT_SUFFIX))
        }
    }
}

private const val MAX_CAUSES = 4
