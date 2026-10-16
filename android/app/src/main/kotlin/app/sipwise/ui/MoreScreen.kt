package app.sipwise.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.BuildConfig
import app.sipwise.R
import app.sipwise.SipwiseApp
import app.sipwise.data.Appearance
import app.sipwise.data.ShareFiles
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.NightSlab
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.SegmentedControl
import app.sipwise.designsystem.SipwiseCard
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.model.mediumDate
import app.sipwise.network.MeResponse
import app.sipwise.network.MobileSessionInfo
import app.sipwise.session.VaultSession
import app.sipwise.update.UpdateUi
import app.sipwise.update.UpdateViewModel
import app.sipwise.vault.VaultViewModel

@Composable
fun MoreScreen(
    settings: SettingsViewModel,
    push: PushViewModel,
    vault: VaultViewModel,
    session: VaultSession,
    user: MeResponse,
    onLock: () -> Unit,
    onSignOut: () -> Unit,
    onAccountDeleted: () -> Unit,
    onManagePortfolios: () -> Unit,
    updates: UpdateViewModel,
) {
    val ui by settings.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(settings) { settings.shares.collect { ShareFiles.share(context, it.title, it.text) } }
    DisposableEffect(Unit) { onDispose { ShareFiles.clear(context) } }
    val appearance by settings.appearance.collectAsStateWithLifecycle()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        AccountCard(user)
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        SectionCard(R.string.settings_appearance) {
            val labels = Appearance.entries.associateWith { stringResource(appearanceLabel(it)) }
            SegmentedControl(Appearance.entries.toList(), appearance, label = { labels.getValue(it) }, onSelect = settings::setAppearance)
            Text(stringResource(R.string.settings_appearance_note), style = MaterialTheme.typography.bodySmall)
        }
        SectionCard(R.string.settings_tax) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FilterChip(
                    selected = ui.filerStatus == FILER,
                    enabled = !ui.busy,
                    onClick = { settings.setFilerStatus(FILER) },
                    label = { Text(stringResource(R.string.settings_tax_filer)) },
                )
                FilterChip(
                    selected = ui.filerStatus == NON_FILER,
                    enabled = !ui.busy,
                    onClick = { settings.setFilerStatus(NON_FILER) },
                    label = { Text(stringResource(R.string.settings_tax_non_filer)) },
                )
            }
            Text(stringResource(R.string.settings_tax_note), style = MaterialTheme.typography.bodySmall)
        }
        SectionCard(R.string.portfolios_title) {
            Text(stringResource(R.string.portfolios_hint), style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = onManagePortfolios) { Text(stringResource(R.string.portfolios_manage)) }
        }
        SecurityCard(vault, session)
        if (user.role == "super_admin") AdminCard()
        NotificationsCard(push)
        AnalyticsCard()
        UsageCard()
        DevicesCard(ui, settings)
        DataCard(settings)
        CrashCard()
        DeleteCard(user, ui, settings, onAccountDeleted)
        UpdateCard(updates, includePrereleases = user.role == "super_admin")
        Button(onClick = onLock, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.lock_now)) }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.sign_out)) }
    }
}

private const val FILER = "filer"
private const val NON_FILER = "non-filer"

private fun appearanceLabel(option: Appearance) =
    when (option) {
        Appearance.SYSTEM -> R.string.settings_appearance_system
        Appearance.LIGHT -> R.string.settings_appearance_light
        Appearance.DARK -> R.string.settings_appearance_dark
    }

@Composable
private fun AccountCard(user: MeResponse) {
    NightSlab(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(BrandColors.button), contentAlignment = Alignment.Center) {
                Text((user.name ?: user.email).take(1).uppercase(), style = MaterialTheme.typography.titleLarge, color = Color.White)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(user.name ?: user.email, style = MaterialTheme.typography.titleMedium, color = SlabColors.ink)
                if (user.name != null) Text(user.email, style = MaterialTheme.typography.bodySmall, color = SlabColors.muted)
                if (user.role == "super_admin") Overline(stringResource(R.string.settings_admin), color = BrandColors.sky)
            }
        }
    }
}

@Composable
internal fun SectionCard(
    title: Int,
    content: @Composable () -> Unit,
) {
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Overline(stringResource(title))
            content()
        }
    }
}

/** The newest crash report, so a crash can be read and sent instead of described from memory. Shown only after a crash. */
@Composable
private fun CrashCard() {
    val context = LocalContext.current
    val crashes = (context.applicationContext as SipwiseApp).container.crashes
    var report by remember { mutableStateOf(crashes.latest()) }
    val text = report ?: return
    SectionCard(R.string.settings_crash_title) {
        Text(stringResource(R.string.settings_crash_note), style = MaterialTheme.typography.bodySmall)
        Text(text.lineSequence().take(CRASH_PREVIEW_LINES).joinToString("\n"), style = MaterialTheme.typography.bodySmall, maxLines = CRASH_PREVIEW_LINES)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedButton(onClick = { ShareFiles.share(context, "sipwise-crash.txt", text) }) { Text(stringResource(R.string.settings_crash_share)) }
            OutlinedButton(
                onClick = {
                    crashes.clear()
                    report = null
                },
            ) { Text(stringResource(R.string.settings_crash_clear)) }
        }
    }
}

private const val CRASH_PREVIEW_LINES = 6

@Composable
private fun DataCard(settings: SettingsViewModel) {
    SectionCard(R.string.settings_data) {
        Text(stringResource(R.string.settings_backup_note), style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = settings::exportEncrypted, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.settings_backup_encrypted))
        }
    }
}

@Composable
private fun DeleteCard(
    user: MeResponse,
    ui: SettingsUi,
    settings: SettingsViewModel,
    onDeleted: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    SectionCard(R.string.settings_delete_title) {
        Text(stringResource(R.string.settings_delete_note), style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_delete_button)) }
    }
    if (open) {
        val ready = typed.trim().equals(user.email.trim(), ignoreCase = true)
        AlertDialog(
            onDismissRequest = {
                if (!ui.deleting) {
                    open = false
                    typed = ""
                    settings.clearDeleteError()
                }
            },
            title = { Text(stringResource(R.string.settings_delete_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(stringResource(R.string.settings_delete_dialog_body, user.email))
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        label = { Text(stringResource(R.string.settings_delete_confirm_label)) },
                        placeholder = { Text(user.email) },
                        singleLine = true,
                    )
                    ui.deleteError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                Button(onClick = { settings.deleteAccount(typed.trim(), onDeleted) }, enabled = ready && !ui.deleting) {
                    Text(stringResource(R.string.settings_delete_everything))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        open = false
                        typed = ""
                        settings.clearDeleteError()
                    },
                    enabled = !ui.deleting,
                ) { Text(stringResource(R.string.entry_cancel)) }
            },
        )
    }
}

@Composable
private fun DevicesCard(
    ui: SettingsUi,
    settings: SettingsViewModel,
) {
    var confirm by remember { mutableStateOf<MobileSessionInfo?>(null) }
    SectionCard(R.string.settings_devices) {
        ui.devicesError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        ui.devices.forEachIndexed { i, device ->
            if (i > 0) HorizontalDivider()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(device.deviceName, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        stringResource(R.string.settings_device_last_used, device.platform, mediumDate(device.lastSeenAt)),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                TextButton(onClick = { confirm = device }) { Text(stringResource(R.string.sign_out)) }
            }
        }
    }
    confirm?.let { device ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(R.string.settings_device_sign_out_title)) },
            text = { Text(device.deviceName) },
            confirmButton = {
                Button(
                    onClick = {
                        settings.signOutDevice(device.id)
                        confirm = null
                    },
                ) { Text(stringResource(R.string.sign_out)) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.entry_cancel)) } },
        )
    }
}

@Composable
private fun UpdateCard(
    viewModel: UpdateViewModel,
    includePrereleases: Boolean,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    SipwiseCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(stringResource(R.string.update_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.update_version_installed, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodyMedium)
            when (val current = ui) {
                UpdateUi.Idle, UpdateUi.UpToDate, is UpdateUi.Failed -> {
                    if (current is UpdateUi.UpToDate) Text(stringResource(R.string.update_up_to_date))
                    if (current is UpdateUi.Failed) Text(current.message, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { viewModel.check(includePrereleases) }) { Text(stringResource(R.string.update_check)) }
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

/** Super admins only: the Research desk and admin console live on the web, not in the app. */
@Composable
private fun AdminCard() {
    val links = LocalUriHandler.current
    SectionCard(R.string.admin_title) {
        Text(stringResource(R.string.admin_hint), style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = { links.openUri(BuildConfig.API_BASE_URL.trimEnd('/') + "/research-desk") }) {
            Text(stringResource(R.string.admin_open))
        }
    }
}
