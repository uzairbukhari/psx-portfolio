package app.sipwise.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.R
import app.sipwise.SipwiseApp
import app.sipwise.data.Appearance
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ReadableExport
import app.sipwise.model.SettingsView
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.network.DeleteAccountRequest
import app.sipwise.network.DeleteAccountResponse
import app.sipwise.network.MobileSessionInfo
import app.sipwise.network.MobileSessionsResponse
import app.sipwise.session.BackupPackage
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import app.sipwise.session.VaultSession
import app.sipwise.session.encryptedBackupShare
import app.sipwise.vault.VaultException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class SettingsUi(
    val filerStatus: String = "",
    val devices: List<MobileSessionInfo> = emptyList(),
    val devicesError: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val deleteError: String? = null,
    val deleting: Boolean = false,
)

/** A file to hand to the share sheet. */
data class ShareRequest(val title: String, val text: String)

/** The Settings (More) screen: appearance, tax status and signed-in devices. */
class SettingsViewModel(
    app: Application,
    private val ledger: Ledger,
    private val session: VaultSession,
) : AndroidViewModel(app) {
    private val container = (app as SipwiseApp).container
    private val _ui = MutableStateFlow(SettingsUi())
    val ui: StateFlow<SettingsUi> = _ui.asStateFlow()
    val appearance: StateFlow<Appearance> = container.preferences.appearance
    private val _shares = MutableSharedFlow<ShareRequest>(extraBufferCapacity = 1)
    val shares: SharedFlow<ShareRequest> = _shares.asSharedFlow()

    init {
        viewModelScope.launch { ledger.version.collect { loadSettings() } }
        loadDevices()
    }

    fun setAppearance(value: Appearance) = container.preferences.setAppearance(value)

    private suspend fun loadSettings() {
        try {
            val view = ApiJson.decodeFromJsonElement(SettingsView.serializer(), ledger.engine.call("settings.view"))
            _ui.value = _ui.value.copy(filerStatus = view.filerStatus)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun setFilerStatus(status: String) {
        if (status == _ui.value.filerStatus) return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.applyAccount("tax", buildJsonObject { put("filerStatus", status) }, status, LedgerAction.TAX)
                _ui.value = _ui.value.copy(busy = false)
            } catch (e: EngineException) {
                fail(e.message)
            } catch (e: ConflictException) {
                fail(e.message)
            } catch (e: VaultLockedException) {
                fail(e.message)
            } catch (e: ApiRequestException) {
                fail(e.message)
            }
        }
    }

    /** The encrypted backup: useless without the vault password or recovery key, so safe to put anywhere. */
    fun exportEncrypted() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(error = null)
            try {
                val json = ApiJson.encodeToString(BackupPackage.serializer(), session.backupPackage())
                val share = encryptedBackupShare(json)
                if (share == null) _ui.value = _ui.value.copy(error = tooLarge()) else _shares.emit(ShareRequest(share.title, share.text))
            } catch (e: VaultException) {
                _ui.value = _ui.value.copy(error = e.message)
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    /** The readable copy is NOT encrypted; the screen asks for confirmation before calling this. */
    fun exportReadable() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(error = null)
            try {
                val out = ApiJson.decodeFromJsonElement(ReadableExport.serializer(), ledger.engine.call("backup.readable"))
                if (out.ok) _shares.emit(ShareRequest(out.title, out.text)) else _ui.value = _ui.value.copy(error = out.reason)
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    /** Deletes the account on the server, then [onDeleted] clears this phone. The error stays in the sheet. */
    fun deleteAccount(
        confirm: String,
        onDeleted: () -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(deleting = true, deleteError = null)
            try {
                container.api.delete("/api/me", DeleteAccountRequest(confirm), DeleteAccountRequest.serializer(), DeleteAccountResponse.serializer())
                onDeleted()
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(deleting = false, deleteError = e.message)
            }
        }
    }

    fun clearDeleteError() {
        _ui.value = _ui.value.copy(deleteError = null)
    }

    private fun tooLarge() = getApplication<Application>().getString(R.string.settings_backup_too_large)

    fun loadDevices() {
        viewModelScope.launch {
            try {
                val reply = container.api.get("/api/mobile-sessions", MobileSessionsResponse.serializer())
                _ui.value = _ui.value.copy(devices = reply.sessions, devicesError = null)
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(devicesError = e.message)
            }
        }
    }

    fun signOutDevice(id: String) {
        viewModelScope.launch {
            try {
                container.api.delete("/api/mobile-sessions?id=$id", JsonElement.serializer())
                loadDevices()
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(devicesError = e.message)
            }
        }
    }

    private fun fail(message: String?) {
        _ui.value = _ui.value.copy(busy = false, error = message)
    }
}
