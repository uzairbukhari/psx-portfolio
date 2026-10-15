package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.ScopeList
import app.sipwise.model.ScopePortfolio
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

data class PortfoliosUi(
    val portfolios: List<ScopePortfolio> = emptyList(),
    val editing: String? = null,
    val name: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

/** Manage portfolios: add, rename, lock or unlock, and delete the empty ones. Each change can be undone from the snackbar. */
class PortfoliosViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(PortfoliosUi())
    val ui: StateFlow<PortfoliosUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            val list = ApiJson.decodeFromJsonElement(ScopeList.serializer(), ledger.engine.call("scope.list")).portfolios
            _ui.value = _ui.value.copy(portfolios = list)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun setName(value: String) {
        _ui.value = _ui.value.copy(name = value.take(NAME_LIMIT))
    }

    fun startRename(item: ScopePortfolio) {
        _ui.value = _ui.value.copy(editing = item.id, name = item.name)
    }

    fun cancelRename() {
        _ui.value = _ui.value.copy(editing = null, name = "")
    }

    fun save() {
        val state = _ui.value
        val editing = state.editing
        if (editing == null) {
            change("portfolio.add", state.name) { put("id", UUID.randomUUID().toString()) }
        } else {
            change("portfolio.rename", state.name) { put("id", editing) }
        }
    }

    fun toggleLock(item: ScopePortfolio) {
        change("portfolio.lock", item.name) {
            put("id", item.id)
            put("locked", !item.locked)
        }
    }

    fun delete(item: ScopePortfolio) {
        if (ledger.scope.value == item.id) ledger.select(ALL_PORTFOLIOS)
        change("portfolio.remove", item.name) { put("id", item.id) }
    }

    private fun change(
        op: String,
        label: String,
        fill: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                val params =
                    buildJsonObject {
                        fill()
                        if (op == "portfolio.add" || op == "portfolio.rename") put("name", _ui.value.name)
                    }
                ledger.applyAccount(op, params, label, LedgerAction.PORTFOLIOS)
                _ui.value = _ui.value.copy(busy = false, editing = null, name = "")
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

    private fun fail(message: String?) {
        _ui.value = _ui.value.copy(busy = false, error = message)
    }

    private companion object {
        const val NAME_LIMIT = 80
    }
}
