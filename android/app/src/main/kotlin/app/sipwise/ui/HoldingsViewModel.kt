package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.AccountOverview
import app.sipwise.model.AssetsView
import app.sipwise.model.HoldingSort
import app.sipwise.model.HoldingsView
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.EngineException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull

data class HoldingsUi(
    val view: HoldingsView? = null,
    val overview: AccountOverview? = null,
    val assets: AssetsView = AssetsView(),
    val sort: HoldingSort = HoldingSort.VALUE,
    val sector: String? = null,
    val showSold: Boolean = false,
    val pricing: Boolean = false,
    val priceMessage: String? = null,
    val error: String? = null,
)

/** The Holdings list: the shared TypeScript sorts, filters and totals; this only holds the choices. */
class HoldingsViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(HoldingsUi())
    val ui: StateFlow<HoldingsUi> = _ui.asStateFlow()
    val scope: StateFlow<String> = ledger.scope

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    fun openPortfolio(id: String) = ledger.select(id)

    /** Fetches fresh PSX prices and waits for the result; the server words the outcome. */
    fun refreshPrices() {
        if (_ui.value.pricing) return
        _ui.value = _ui.value.copy(pricing = true, priceMessage = null)
        viewModelScope.launch {
            val message =
                try {
                    ledger.refreshPrices { _ui.value = _ui.value.copy(priceMessage = it.message) }?.message
                } catch (e: ApiRequestException) {
                    e.message
                }
            _ui.value = _ui.value.copy(pricing = false, priceMessage = message)
        }
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
                val reply = ledger.view("holdings.view", args)
                _ui.value = _ui.value.copy(view = ApiJson.decodeFromJsonElement(HoldingsView.serializer(), reply), error = null)
                loadExtras()
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    /** Net worth and the other asset classes; a failure here must not hide the stocks, so it is dropped quietly. */
    private suspend fun loadExtras() {
        try {
            val overview = ledger.view("overview.view")
            val assets = ledger.view("assets.view")
            _ui.value =
                _ui.value.copy(
                    overview = if (overview is JsonNull) null else ApiJson.decodeFromJsonElement(AccountOverview.serializer(), overview),
                    assets = ApiJson.decodeFromJsonElement(AssetsView.serializer(), assets),
                )
        } catch (ignored: EngineException) {
            _ui.value = _ui.value.copy(overview = null, assets = AssetsView())
        }
    }
}
