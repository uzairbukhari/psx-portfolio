package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.sipwise.BuildConfig
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.update.UpdateUi
import app.sipwise.update.UpdateViewModel

@Composable
fun MoreScreen(
    onLock: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text(stringResource(R.string.more_account), style = MaterialTheme.typography.titleMedium)
        Button(onClick = onLock) { Text(stringResource(R.string.lock_now)) }
        OutlinedButton(onClick = onSignOut) { Text(stringResource(R.string.sign_out)) }
        UpdateCard()
    }
}

@Composable
private fun UpdateCard(viewModel: UpdateViewModel = viewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Card {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.update_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.update_version_installed, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodyMedium)
            when (val current = ui) {
                UpdateUi.Idle, UpdateUi.UpToDate, is UpdateUi.Failed -> {
                    if (current is UpdateUi.UpToDate) Text(stringResource(R.string.update_up_to_date))
                    if (current is UpdateUi.Failed) Text(current.message, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = viewModel::check) { Text(stringResource(R.string.update_check)) }
                }
                UpdateUi.Checking -> Text(stringResource(R.string.update_checking))
                is UpdateUi.Available -> {
                    Text(stringResource(R.string.update_available, current.update.version))
                    if (current.update.notes.isNotBlank()) Text(current.update.notes, style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { viewModel.install(current.update) }) { Text(stringResource(R.string.update_install)) }
                }
                is UpdateUi.Downloading -> {
                    Text(stringResource(R.string.update_downloading))
                    LinearProgressIndicator(progress = { current.progress }, modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs))
                }
                is UpdateUi.NeedsPermission -> {
                    Text(stringResource(R.string.update_permission))
                    Button(onClick = { context.startActivity(viewModel.permissionIntent()) }) { Text(stringResource(R.string.update_open_settings)) }
                }
            }
        }
    }
}
