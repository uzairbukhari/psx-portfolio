package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.model.HoldingSort
import app.sipwise.model.HoldingsView
import app.sipwise.network.ApiJson
import app.sipwise.session.EngineClient
import app.sipwise.session.EngineException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HoldingsUi(
    val view: HoldingsView? = null,
    val sort: HoldingSort = HoldingSort.VALUE,
    val sector: String? = null,
    val showSold: Boolean = false,
    val error: String? = null,
)

/** The Holdings list: the shared TypeScript sorts, filters and totals; this only holds the choices. */
class HoldingsViewModel(private val engine: EngineClient) : ViewModel() {
    private val _ui = MutableStateFlow(HoldingsUi())
    val ui: StateFlow<HoldingsUi> = _ui.asStateFlow()

    init {
        load()
    }

    fun setSort(sort: HoldingSort) {
        _ui.value = _ui.value.copy(sort = sort)
        load()
    }

    fun setSector(sector: String?) {
        _ui.value = _ui.value.copy(sector = sector)
        load()
    }

    fun setShowSold(show: Boolean) {
        _ui.value = _ui.value.copy(showSold = show)
    }

    private fun load() {
        viewModelScope.launch {
            val current = _ui.value
            val args = buildMap { put("sort", current.sort.wire).also { current.sector?.let { s -> put("sector", s) } } }
            try {
                val reply = engine.call("holdings.view", args)
                _ui.value = _ui.value.copy(view = ApiJson.decodeFromJsonElement(HoldingsView.serializer(), reply), error = null)
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }
}
