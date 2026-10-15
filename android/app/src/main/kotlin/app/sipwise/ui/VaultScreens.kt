package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import app.sipwise.R
import app.sipwise.designsystem.Spacing
import app.sipwise.vault.BiometricState

@Composable
private fun ScreenColumn(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) { content() }
}

@Composable
private fun ErrorText(error: String?) {
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun PasswordField(
    value: String,
    onChange: (String) -> Unit,
    label: Int,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(stringResource(label)) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun VaultSetupScreen(
    busy: Boolean,
    error: String?,
    onCreate: (String) -> Unit,
) {
    var password by rememberSaveable { mutableStateOf("") }
    var again by rememberSaveable { mutableStateOf("") }
    ScreenColumn {
        Text(stringResource(R.string.vault_setup_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.vault_setup_body), style = MaterialTheme.typography.bodyMedium)
        PasswordField(password, { password = it }, R.string.vault_password)
        PasswordField(again, { again = it }, R.string.vault_password_again)
        if (again.isNotEmpty() && again != password) {
            Text(stringResource(R.string.vault_password_mismatch), color = MaterialTheme.colorScheme.error)
        }
        ErrorText(error)
        Button(
            onClick = { onCreate(password) },
            enabled = !busy && password.isNotEmpty() && password == again,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (busy) R.string.working else R.string.vault_create)) }
    }
}

@Composable
fun RecoveryKeyScreen(
    recoveryKey: String,
    busy: Boolean,
    error: String?,
    onSaved: () -> Unit,
    onCancel: () -> Unit,
) {
    ScreenColumn {
        Text(stringResource(R.string.recovery_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.recovery_body), style = MaterialTheme.typography.bodyMedium)
        Text(recoveryKey, style = MaterialTheme.typography.titleLarge)
        ErrorText(error)
        Button(onClick = onSaved, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (busy) R.string.working else R.string.recovery_saved))
        }
        TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.cancel)) }
    }
}

@Composable
fun UnlockScreen(
    offline: Boolean,
    busy: Boolean,
    error: String?,
    biometric: BiometricState,
    onUnlock: (password: String, remember: Boolean) -> Unit,
    onBiometric: () -> Unit,
    onForgot: () -> Unit,
    onErase: () -> Unit,
    onSignOut: () -> Unit,
) {
    var password by rememberSaveable { mutableStateOf("") }
    var remember by rememberSaveable { mutableStateOf(false) }
    var tried by rememberSaveable { mutableStateOf(false) }
    // Offer the fingerprint prompt once on arrival; the password form stays as the fallback.
    LaunchedEffect(biometric.enabled) {
        if (biometric.enabled && !tried) {
            tried = true
            onBiometric()
        }
    }
    ScreenColumn {
        Text(stringResource(R.string.unlock_title), style = MaterialTheme.typography.headlineSmall)
        if (offline) Text(stringResource(R.string.unlock_offline), style = MaterialTheme.typography.bodyMedium)
        if (biometric.enabled) {
            Button(onClick = onBiometric, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.biometric_unlock_button))
            }
        }
        PasswordField(password, { password = it }, R.string.vault_password)
        if (biometric.available && !biometric.enabled) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = remember, onCheckedChange = { remember = it })
                Text(stringResource(R.string.biometric_remember), style = MaterialTheme.typography.bodyMedium)
            }
        }
        ErrorText(error)
        Button(
            onClick = { onUnlock(password, remember) },
            enabled = !busy && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (busy) R.string.unlocking else R.string.unlock)) }
        TextButton(onClick = onForgot, enabled = !busy && !offline) { Text(stringResource(R.string.unlock_forgot)) }
        TextButton(onClick = onErase, enabled = !busy && !offline) { Text(stringResource(R.string.erase_link)) }
        TextButton(onClick = onSignOut, enabled = !busy) { Text(stringResource(R.string.sign_out)) }
    }
}

@Composable
fun RecoverScreen(
    busy: Boolean,
    error: String?,
    onRecover: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    var key by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    ScreenColumn {
        Text(stringResource(R.string.recover_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.recover_body), style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            label = { Text(stringResource(R.string.recover_key)) },
            modifier = Modifier.fillMaxWidth(),
        )
        PasswordField(password, { password = it }, R.string.recover_new_password)
        ErrorText(error)
        Button(
            onClick = { onRecover(key.trim(), password) },
            enabled = !busy && key.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (busy) R.string.working else R.string.recover_action)) }
        TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.back)) }
    }
}

@Composable
fun VaultFailedScreen(
    message: String,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
) {
    ScreenColumn {
        Text(stringResource(R.string.vault_failed_title), style = MaterialTheme.typography.headlineSmall)
        Text(message, style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.retry)) }
        TextButton(onClick = onSignOut) { Text(stringResource(R.string.sign_out)) }
    }
}

@Composable
fun EraseVaultScreen(
    email: String,
    busy: Boolean,
    error: String?,
    onErase: () -> Unit,
    onBack: () -> Unit,
) {
    var typed by rememberSaveable { mutableStateOf("") }
    ScreenColumn {
        Text(stringResource(R.string.erase_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.erase_body, email), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = typed,
            onValueChange = { typed = it },
            label = { Text(stringResource(R.string.erase_type)) },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(error)
        Button(
            onClick = onErase,
            enabled = !busy && typed.trim() == ERASE_WORD,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (busy) R.string.working else R.string.erase_action)) }
        TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.back)) }
    }
}

private const val ERASE_WORD = "ERASE"
