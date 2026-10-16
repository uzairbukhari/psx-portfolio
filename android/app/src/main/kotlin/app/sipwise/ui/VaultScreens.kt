package app.sipwise.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.view.WindowManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.sipwise.R
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.GeistMonoFamily
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StepsMark
import app.sipwise.vault.BiometricState
import app.sipwise.vault.UnlockStage
import app.sipwise.vault.checkPassword
import kotlin.math.roundToInt

/** The shared frame of every vault screen: Night, the steps mark, then the screen's own column. */
@Composable
private fun VaultFrame(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    FirstRunScene {
        Column(
            modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) { content() }
    }
}

@Composable
private fun Heading(
    title: String,
    body: String? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = FirstRunInk.text)
        if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium, color = FirstRunInk.muted)
    }
}

@Composable
private fun TopMark() {
    StepsMark(Modifier.size(width = 44.dp, height = 36.dp), tint = Color.White)
}

@Composable
fun VaultSetupScreen(
    email: String,
    busy: Boolean,
    error: String?,
    onCreate: (String) -> Unit,
) {
    var password by rememberSaveable { mutableStateOf("") }
    var again by rememberSaveable { mutableStateOf("") }
    var step by rememberSaveable { mutableStateOf(1) }
    val check = checkPassword(password, email)
    VaultFrame {
        TopMark()
        StepperBar(step, 2)
        if (step == 1) {
            Heading(stringResource(R.string.vault_setup_title), stringResource(R.string.vault_setup_body))
            FirstRunField(password, { password = it }, stringResource(R.string.vault_password), secret = true)
            StrengthMeter(check)
            CheckLine(stringResource(R.string.vault_check_length), check.longEnough)
            CheckLine(stringResource(R.string.vault_check_obvious), password.isNotEmpty() && check.notObvious)
            Spacer(Modifier.height(Spacing.sm))
            BrandButton(stringResource(R.string.vault_continue), onClick = { step = 2 }, enabled = check.longEnough)
        } else {
            Heading(stringResource(R.string.vault_confirm_title), stringResource(R.string.vault_confirm_body))
            FirstRunField(again, { again = it }, stringResource(R.string.vault_password_again), secret = true, enabled = !busy, isError = again.isNotEmpty() && again != password)
            if (again.isNotEmpty() && again != password) NoticeCard(stringResource(R.string.vault_password_mismatch))
            if (error != null) NoticeCard(error)
            Spacer(Modifier.height(Spacing.sm))
            BrandButton(
                stringResource(if (busy) R.string.working else R.string.vault_create),
                onClick = { onCreate(password) },
                enabled = password.isNotEmpty() && password == again,
                busy = busy,
            )
            LinkText(stringResource(R.string.back), onClick = { step = 1 }, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

/** Keeps the recovery key out of screenshots and the recents thumbnail while it is on screen. */
@Composable
private fun SecureWindow() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

private fun copySensitive(
    context: Context,
    text: String,
) {
    val clip = ClipData.newPlainText("recovery", text)
    clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)
}

private fun shareText(
    context: Context,
    text: String,
    title: String,
) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

private const val KEY_GROUP = 4
private const val KEY_COLUMNS = 3

/** The key as readable blocks: its own dashes if it has them, otherwise groups of four. */
private fun keyBlocks(key: String): List<String> {
    val parts = key.trim().split('-').filter { it.isNotBlank() }
    return if (parts.size > 1) parts else key.trim().chunked(KEY_GROUP)
}

@Composable
fun RecoveryKeyScreen(
    recoveryKey: String,
    busy: Boolean,
    error: String?,
    onSaved: () -> Unit,
    onCancel: () -> Unit,
) {
    SecureWindow()
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    var confirmed by rememberSaveable { mutableStateOf(false) }
    VaultFrame {
        TopMark()
        StepperBar(2, 2)
        Heading(stringResource(R.string.recovery_title), stringResource(R.string.recovery_body))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(FirstRunInk.field)
                .border(1.dp, FirstRunInk.fieldLine, RoundedCornerShape(20.dp))
                .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            keyBlocks(recoveryKey).chunked(KEY_COLUMNS).forEach { line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    line.forEach { block ->
                        Text(
                            block,
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium.copy(fontFamily = GeistMonoFamily),
                            color = FirstRunInk.text,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GhostButton(
                stringResource(if (copied) R.string.recovery_copied else R.string.recovery_copy),
                onClick = {
                    copySensitive(context, recoveryKey)
                    copied = true
                },
                modifier = Modifier.weight(1f),
            )
            GhostButton(
                stringResource(R.string.recovery_share),
                onClick = { shareText(context, recoveryKey, context.getString(R.string.recovery_share)) },
                modifier = Modifier.weight(1f),
            )
        }
        NoticeCard(stringResource(R.string.recovery_warning), tone = FirstRunInk.amber)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { confirmed = !confirmed },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = confirmed,
                onCheckedChange = { confirmed = it },
                colors = CheckboxDefaults.colors(checkedColor = BrandColors.sky, uncheckedColor = FirstRunInk.muted, checkmarkColor = FirstRunInk.night),
            )
            Text(stringResource(R.string.recovery_confirm), style = MaterialTheme.typography.bodyMedium, color = FirstRunInk.text)
        }
        if (error != null) NoticeCard(error)
        BrandButton(
            stringResource(if (busy) R.string.working else R.string.recovery_saved),
            onClick = onSaved,
            enabled = confirmed,
            busy = busy,
        )
        LinkText(stringResource(R.string.cancel), onClick = onCancel, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
private fun stageText(stage: UnlockStage?): String? =
    when (stage) {
        UnlockStage.CHECKING -> stringResource(R.string.unlock_stage_checking)
        UnlockStage.OPENING -> stringResource(R.string.unlock_stage_opening)
        UnlockStage.LOADING -> stringResource(R.string.unlock_stage_loading)
        null -> null
    }

private const val SHAKE_PX = 14f
private const val SHAKE_MS = 55

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UnlockScreen(
    email: String,
    offline: Boolean,
    busy: Boolean,
    stage: UnlockStage?,
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
    var usePassword by rememberSaveable { mutableStateOf(false) }
    var help by remember { mutableStateOf(false) }
    val shake = remember { Animatable(0f) }
    val haptics = LocalHapticFeedback.current
    // Offer the fingerprint prompt once on arrival; the password form stays as the fallback.
    LaunchedEffect(biometric.enabled) {
        if (biometric.enabled && !tried) {
            tried = true
            onBiometric()
        }
    }
    LaunchedEffect(error) {
        if (error != null) {
            usePassword = true
            haptics.performHapticFeedback(HapticFeedbackType.Reject)
            repeat(2) {
                shake.animateTo(SHAKE_PX, tween(SHAKE_MS))
                shake.animateTo(-SHAKE_PX, tween(SHAKE_MS))
            }
            shake.animateTo(0f, tween(SHAKE_MS))
        }
    }
    val showFingerprint = biometric.enabled && !usePassword
    VaultFrame {
        TopMark()
        Heading(stringResource(R.string.unlock_welcome), maskEmail(email))
        if (offline) NoticeCard(stringResource(R.string.unlock_offline), tone = FirstRunInk.amber)
        Column(Modifier.offset { IntOffset(shake.value.roundToInt(), 0) }, verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            if (showFingerprint) {
                Box(Modifier.fillMaxWidth().padding(vertical = Spacing.lg), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.size(96.dp).clip(CircleShape).background(FirstRunInk.field).border(1.dp, FirstRunInk.fieldLine, CircleShape).clickable(enabled = !busy, onClick = onBiometric),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.Fingerprint, contentDescription = stringResource(R.string.biometric_unlock_button), tint = BrandColors.sky, modifier = Modifier.size(52.dp))
                    }
                }
                BrandButton(stringResource(R.string.biometric_unlock_button), onClick = onBiometric, enabled = !busy)
                LinkText(stringResource(R.string.unlock_use_password), onClick = { usePassword = true }, modifier = Modifier.align(Alignment.CenterHorizontally))
            } else {
                FirstRunField(password, { password = it }, stringResource(R.string.vault_password), secret = true, enabled = !busy, isError = error != null)
                if (biometric.available && !biometric.enabled) {
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { remember = !remember },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = remember,
                            onCheckedChange = { remember = it },
                            colors = CheckboxDefaults.colors(checkedColor = BrandColors.sky, uncheckedColor = FirstRunInk.muted, checkmarkColor = FirstRunInk.night),
                        )
                        Text(stringResource(R.string.biometric_remember), style = MaterialTheme.typography.bodySmall, color = FirstRunInk.muted)
                    }
                }
                if (error != null) NoticeCard(error)
                val narration = stageText(stage)
                if (busy && narration != null) Text(narration, style = MaterialTheme.typography.bodySmall, color = FirstRunInk.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
                BrandButton(
                    stringResource(if (busy) R.string.unlocking else R.string.unlock),
                    onClick = { onUnlock(password, remember) },
                    enabled = password.isNotEmpty(),
                    busy = busy,
                )
                if (biometric.enabled) {
                    LinkText(
                        stringResource(R.string.biometric_unlock_button),
                        onClick = {
                            usePassword = false
                            onBiometric()
                        },
                        enabled = !busy,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            LinkText(stringResource(R.string.unlock_forgot), onClick = { help = true }, enabled = !busy)
            LinkText(stringResource(R.string.sign_out), onClick = onSignOut, enabled = !busy, color = FirstRunInk.muted)
        }
    }
    if (help) {
        ModalBottomSheet(onDismissRequest = { help = false }, containerColor = FirstRunInk.night, contentColor = FirstRunInk.text) {
            Column(Modifier.fillMaxWidth().padding(horizontal = Spacing.xl).padding(bottom = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = BrandColors.sky, modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.unlock_help_title), style = MaterialTheme.typography.titleLarge, color = FirstRunInk.text)
                }
                BrandButton(
                    stringResource(R.string.unlock_help_recover),
                    onClick = {
                        help = false
                        onForgot()
                    },
                    enabled = !busy && !offline,
                )
                GhostButton(
                    stringResource(R.string.erase_link),
                    onClick = {
                        help = false
                        onErase()
                    },
                    enabled = !busy && !offline,
                    danger = true,
                )
            }
        }
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
    VaultFrame {
        TopMark()
        Heading(stringResource(R.string.recover_title), stringResource(R.string.recover_body))
        FirstRunField(key, { key = it }, stringResource(R.string.recover_key), enabled = !busy)
        FirstRunField(password, { password = it }, stringResource(R.string.recover_new_password), secret = true, enabled = !busy)
        if (error != null) NoticeCard(error)
        BrandButton(
            stringResource(if (busy) R.string.working else R.string.recover_action),
            onClick = { onRecover(key.trim(), password) },
            enabled = key.isNotBlank() && password.isNotEmpty(),
            busy = busy,
        )
        LinkText(stringResource(R.string.back), onClick = onBack, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
fun VaultFailedScreen(
    message: String,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
) {
    VaultFrame {
        TopMark()
        Heading(stringResource(R.string.vault_failed_title))
        NoticeCard(message)
        BrandButton(stringResource(R.string.retry), onClick = onRetry)
        LinkText(stringResource(R.string.sign_out), onClick = onSignOut, modifier = Modifier.align(Alignment.CenterHorizontally))
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
    VaultFrame {
        TopMark()
        Heading(stringResource(R.string.erase_title))
        NoticeCard(stringResource(R.string.erase_body, email))
        FirstRunField(typed, { typed = it }, stringResource(R.string.erase_type), enabled = !busy)
        if (error != null) NoticeCard(error)
        GhostButton(
            stringResource(if (busy) R.string.working else R.string.erase_action),
            onClick = onErase,
            enabled = !busy && typed.trim() == ERASE_WORD,
            danger = true,
        )
        LinkText(stringResource(R.string.back), onClick = onBack, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

private const val ERASE_WORD = "ERASE"
