package app.sipwise.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.sipwise.R

@Composable
fun NotificationsCard(viewModel: PushViewModel) {
    val ui by viewModel.ui.collectAsState()
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) viewModel.enable() else viewModel.denied()
        }
    SectionCard(R.string.settings_notifications) {
        if (!ui.available) {
            Text(stringResource(R.string.settings_notifications_unavailable), style = MaterialTheme.typography.bodyMedium)
            return@SectionCard
        }
        Text(stringResource(R.string.settings_notifications_hint), style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.settings_notifications_switch), style = MaterialTheme.typography.bodyLarge)
            Switch(
                checked = ui.enabled,
                enabled = !ui.busy,
                onCheckedChange = { on ->
                    when {
                        !on -> viewModel.disable()
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else -> viewModel.enable()
                    }
                },
            )
        }
        if (ui.enabled) OutlinedButton(onClick = viewModel::test, enabled = !ui.busy) { Text(stringResource(R.string.settings_notifications_test)) }
        ui.notice?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall) }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
