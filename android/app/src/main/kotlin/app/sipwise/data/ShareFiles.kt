package app.sipwise.data

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

private const val MIME_JSON = "application/json"
private const val EXPORT_DIR = "exports"

/** Hands an export to the share sheet as a file in the app cache (the share sheet cannot carry large text). */
object ShareFiles {
    fun share(
        context: Context,
        title: String,
        text: String,
    ) {
        val dir = File(context.cacheDir, EXPORT_DIR).apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, title).apply { writeText(text) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send =
            Intent(Intent.ACTION_SEND)
                .setType(MIME_JSON)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Removes exported files, so a readable copy does not linger after it was shared. */
    fun clear(context: Context) {
        File(context.cacheDir, EXPORT_DIR).listFiles()?.forEach { it.delete() }
    }
}
