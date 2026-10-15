package app.sipwise.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.R
import app.sipwise.SipwiseApp
import app.sipwise.network.ApiRequestException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PushUi(
    val available: Boolean = false,
    val enabled: Boolean = false,
    val busy: Boolean = false,
    val notice: Int? = null,
    val error: String? = null,
)

/** The Notifications card in More: turn dividend alerts on or off for this phone and send a test. */
class PushViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as SipwiseApp).container
    private val push = container.push
    private val _ui = MutableStateFlow(PushUi(available = push.available(), enabled = container.preferences.pushEnabled.value))
    val ui: StateFlow<PushUi> = _ui.asStateFlow()

    fun enable() = run(R.string.settings_notifications_on_done) {
        val token = push.token() ?: error(getApplication<Application>().getString(R.string.settings_notifications_no_token))
        push.register(token)
        container.preferences.setPushEnabled(true)
        _ui.value = _ui.value.copy(enabled = true)
    }

    fun disable() = run(R.string.settings_notifications_off_done) {
        push.unregister()
        container.preferences.setPushEnabled(false)
        _ui.value = _ui.value.copy(enabled = false)
    }

    fun test() = run(R.string.settings_notifications_test_done) { push.test() }

    fun denied() {
        _ui.value = _ui.value.copy(notice = R.string.settings_notifications_denied)
    }

    private fun run(
        done: Int,
        block: suspend () -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, notice = null, error = null)
            try {
                block()
                _ui.value = _ui.value.copy(busy = false, notice = done)
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(busy = false, error = e.message)
            } catch (e: IllegalStateException) {
                _ui.value = _ui.value.copy(busy = false, error = e.message)
            }
        }
    }
}
