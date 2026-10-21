package app.sipwise.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.SipwiseApp
import app.sipwise.data.Appearance
import app.sipwise.designsystem.ChartPalette
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.SettingsView
import app.sipwise.network.ApiRequestException
import app.sipwise.network.DeleteAccountRequest
import app.sipwise.network.DeleteAccountResponse
import app.sipwise.network.MobileSessionInfo
import app.sipwise.network.MobileSessionsResponse
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import app.sipwise.session.decodeView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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

/** The Settings (More) screen: appearance, tax status and signed-in devices. */
class SettingsViewModel(
    app: Application,
    private val ledger: Ledger,
) : AndroidViewModel(app) {
    private val container = (app as SipwiseApp).container
    private val _ui = MutableStateFlow(SettingsUi())
    val ui: StateFlow<SettingsUi> = _ui.asStateFlow()
    val appearance: StateFlow<Appearance> = container.preferences.appearance
    val chartPalette: StateFlow<ChartPalette> = container.preferences.chartPalette

    init {
        viewModelScope.launch { ledger.version.collect { loadSettings() } }
        loadDevices()
    }

    fun setAppearance(value: Appearance) = container.preferences.setAppearance(value)

    fun setChartPalette(value: ChartPalette) = container.preferences.setChartPalette(value)

    private suspend fun loadSettings() {
        try {
            val view = decodeView(SettingsView.serializer(), ledger.engine.call("settings.view"))
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
