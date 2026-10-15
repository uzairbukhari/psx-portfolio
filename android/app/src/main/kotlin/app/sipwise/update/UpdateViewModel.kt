package app.sipwise.update

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.network.AvailableUpdate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface UpdateUi {
    data object Idle : UpdateUi

    data object Checking : UpdateUi

    data object UpToDate : UpdateUi

    data class Available(val update: AvailableUpdate) : UpdateUi

    data class Downloading(val update: AvailableUpdate, val progress: Float) : UpdateUi

    /** The person must allow installs from this app first. */
    data class NeedsPermission(val update: AvailableUpdate) : UpdateUi

    data class Failed(val message: String) : UpdateUi
}

class UpdateViewModel(app: Application) : AndroidViewModel(app) {
    private val manager = UpdateManager(app)
    private val _ui = MutableStateFlow<UpdateUi>(UpdateUi.Idle)
    val ui: StateFlow<UpdateUi> = _ui.asStateFlow()

    fun permissionIntent() = manager.permissionIntent()

    fun check() {
        viewModelScope.launch {
            _ui.value = UpdateUi.Checking
            _ui.value =
                try {
                    manager.check()?.let { UpdateUi.Available(it) } ?: UpdateUi.UpToDate
                } catch (e: UpdateException) {
                    UpdateUi.Failed(e.message.orEmpty())
                }
        }
    }

    fun install(update: AvailableUpdate) {
        if (!manager.canInstall()) {
            _ui.value = UpdateUi.NeedsPermission(update)
            return
        }
        viewModelScope.launch {
            _ui.value = UpdateUi.Downloading(update, 0f)
            try {
                val file = manager.download(update) { _ui.value = UpdateUi.Downloading(update, it) }
                manager.install(file)
                _ui.value = UpdateUi.Idle
            } catch (e: UpdateException) {
                _ui.value = UpdateUi.Failed(e.message.orEmpty())
            }
        }
    }
}
