package app.sipwise.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.BuildConfig
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.update.UpdateUi
import app.sipwise.update.UpdateViewModel

private const val NOTES_LINES = 8

/** Checks for a promoted release (or a pre-release for the owner) when the app opens or returns, and asks whether to install it now. */
@Composable
fun UpdatePrompt(
    viewModel: UpdateViewModel,
    includePrereleases: Boolean,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val declined by viewModel.declined.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.quietCheck(includePrereleases) }
    when (val current = ui) {
        is UpdateUi.Available ->
            if (declined != current.update.version) {
                AlertDialog(
                    onDismissRequest = { viewModel.decline(current.update.version) },
                    title = { Text(stringResource(R.string.update_prompt_title)) },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            Text(stringResource(R.string.update_prompt_body, current.update.version, BuildConfig.VERSION_NAME))
                            if (current.update.notes.isNotBlank()) {
                                Text(current.update.notes, style = MaterialTheme.typography.bodySmall, maxLines = NOTES_LINES, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    },
                    confirmButton = { Button(onClick = { viewModel.install(current.update) }) { Text(stringResource(R.string.update_prompt_install)) } },
                    dismissButton = { TextButton(onClick = { viewModel.decline(current.update.version) }) { Text(stringResource(R.string.update_prompt_later)) } },
                )
            }
        is UpdateUi.Downloading ->
            AlertDialog(
                onDismissRequest = {},
                title = { Text(stringResource(R.string.update_downloading)) },
                text = { LinearProgressIndicator(progress = { current.progress }, modifier = Modifier.fillMaxWidth()) },
                confirmButton = {},
            )
        is UpdateUi.NeedsPermission ->
            AlertDialog(
                onDismissRequest = { viewModel.decline(current.update.version) },
                title = { Text(stringResource(R.string.update_prompt_title)) },
                text = { Text(stringResource(R.string.update_permission)) },
                confirmButton = {
                    Button(onClick = { context.startActivity(Intent(viewModel.permissionIntent())) }) { Text(stringResource(R.string.update_open_settings)) }
                },
                dismissButton = { TextButton(onClick = { viewModel.decline(current.update.version) }) { Text(stringResource(R.string.update_prompt_later)) } },
            )
        is UpdateUi.Failed ->
            if (current.fromInstall) {
                AlertDialog(
                    onDismissRequest = viewModel::acknowledge,
                    title = { Text(stringResource(R.string.update_prompt_failed)) },
                    text = { Text(current.message) },
                    confirmButton = { TextButton(onClick = viewModel::acknowledge) { Text(stringResource(R.string.update_prompt_ok)) } },
                )
            }
        else -> Unit
    }
}
