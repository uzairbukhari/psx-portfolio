package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.R
import app.sipwise.session.VaultSession
import app.sipwise.vault.VaultViewModel

/** Fingerprint or face unlock for the vault. Only shown when the phone has an enrolled strong biometric. */
@Composable
fun SecurityCard(
    vault: VaultViewModel,
    session: VaultSession,
) {
    val state by vault.biometric.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findFragmentActivity()
    if (!state.available || activity == null) return
    SectionCard(R.string.settings_security) {
        Text(stringResource(R.string.settings_security_hint), style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.settings_security_switch), style = MaterialTheme.typography.bodyLarge)
            Switch(checked = state.enabled, onCheckedChange = { vault.setBiometric(activity, session, it) })
        }
    }
}
