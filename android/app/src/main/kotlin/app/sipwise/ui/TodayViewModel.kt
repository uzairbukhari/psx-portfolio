package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.AccountOverview
import app.sipwise.model.AssetsView
import app.sipwise.model.TodayView
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.EngineException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull

data class TodayUi(
    val view: TodayView? = null,
    val showReturn: Boolean = false,
    val pricing: Boolean = false,
    val skippedWelcome: Boolean = false,
    val overview: AccountOverview? = null,
    val assets: AssetsView = AssetsView(),
    val error: String? = null,
)

/** The Today screen: every figure comes from the shared TypeScript; this only holds what is expanded. */
class TodayViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(TodayUi())
    val ui: StateFlow<TodayUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    fun skipWelcome() {
        _ui.value = _ui.value.copy(skippedWelcome = true)
    }

    fun toggleReturn() {
        _ui.value = _ui.value.copy(showReturn = !_ui.value.showReturn)
    }

    /** The "Refresh prices" action: runs the queued price job and reloads Today when it settles. */
    fun refreshPrices() {
        if (_ui.value.pricing) return
        _ui.value = _ui.value.copy(pricing = true)
        viewModelScope.launch {
            try {
                ledger.refreshPrices()
            } catch (ignored: ApiRequestException) {
                // A failed refresh leaves the old prices; Holdings shows the server's wording for it.
            }
            _ui.value = _ui.value.copy(pricing = false)
        }
    }

    fun load() {
        viewModelScope.launch {
            try {
                val reply = ledger.view("today.view")
                val view = ApiJson.decodeFromJsonElement(TodayView.serializer(), reply)
                _ui.value = _ui.value.copy(view = view, error = null)
                if (view.hasAssets) loadAssets() else _ui.value = _ui.value.copy(overview = null, assets = AssetsView())
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    /** Net worth and the asset classes, for a portfolio that holds funds, plans or metals; a failure only hides that dashboard. */
    private suspend fun loadAssets() {
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
