package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.AccountOverview
import app.sipwise.model.AssetsView
import app.sipwise.model.DayMove
import app.sipwise.model.MarketSummaryBody
import app.sipwise.model.PortfolioMove
import app.sipwise.model.SipView
import app.sipwise.model.TodayView
import app.sipwise.model.TrackRange
import app.sipwise.model.TrackView
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiRequestException
import app.sipwise.session.EngineException
import app.sipwise.session.decodeView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull

data class TodayUi(
    val view: TodayView? = null,
    val showReturn: Boolean = false,
    val pricing: Boolean = false,
    val skippedWelcome: Boolean = false,
    val overview: AccountOverview? = null,
    val assets: AssetsView = AssetsView(),
    /** This month's SIP Blueprint, for the card that links to it; null while there is no plan. */
    val sip: SipView? = null,
    val market: MarketSummaryBody? = null,
    val marketOpen: Boolean = false,
    val move: DayMove? = null,
    /** Each portfolio's own move today, by portfolio id. */
    val moves: Map<String, DayMove> = emptyMap(),
    val track: TrackView? = null,
    val range: TrackRange = TrackRange.HALF,
    val historyFailed: Boolean = false,
    val error: String? = null,
)

/** The Today screen: every figure comes from the shared TypeScript; this only holds what is expanded. */
class TodayViewModel(
    private val ledger: Ledger,
    api: ApiClient,
) : ViewModel() {
    private val histories = TrackHistories(ledger, api)
    private var historyJob: Job? = null

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
                val view = decodeView(TodayView.serializer(), reply)
                _ui.value = _ui.value.copy(view = view, error = null)
                // Net worth counts every class, so the overview is loaded for a stock-only portfolio too; only the
                // gold, plan and fund sections need the assets view.
                loadOverview(view.hasAssets)
                loadSip()
                if (view.hasStocks && !view.firstUse) loadHistory()
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            } catch (e: SerializationException) {
                _ui.value = _ui.value.copy(error = e.javaClass.simpleName)
            }
        }
    }

    fun setRange(range: TrackRange) {
        _ui.value = _ui.value.copy(range = range)
        loadHistory()
    }

    fun retryHistory() = loadHistory(force = true)

    /** The day move and the value chart both come from daily closes; a failure only hides those two cards. */
    private fun loadHistory(force: Boolean = false) {
        historyJob?.cancel()
        historyJob =
            viewModelScope.launch {
                try {
                    val closes = histories.load(force)
                    if (closes == null) {
                        _ui.value = _ui.value.copy(move = null, track = null, historyFailed = false)
                        return@launch
                    }
                    val move = ledger.view("today.move", mapOf("histories" to closes.recent))
                    val track = ledger.view("track.view", mapOf("range" to _ui.value.range.key, "histories" to closes.full))
                    val moves = ledger.view("today.portfolioMoves", mapOf("histories" to closes.recent))
                    _ui.value =
                        _ui.value.copy(
                            move = decodeView(DayMove.serializer(), move),
                            moves = decodeView(ListSerializer(PortfolioMove.serializer()), moves).associate { it.id to it.move },
                            track = decodeView(TrackView.serializer(), track),
                            historyFailed = false,
                        )
                } catch (ignored: EngineException) {
                    _ui.value = _ui.value.copy(historyFailed = true)
                } catch (ignored: ApiRequestException) {
                    _ui.value = _ui.value.copy(historyFailed = true)
                } catch (ignored: SerializationException) {
                    _ui.value = _ui.value.copy(historyFailed = true)
                }
            }
    }

    /** The market pulse, polled by the screen while it is on top. Public data, no holdings. */
    suspend fun loadMarket() {
        val reply = ledger.marketSummary() ?: return
        val open =
            try {
                ledger.marketOpen()
            } catch (ignored: EngineException) {
                false
            }
        _ui.value = _ui.value.copy(market = reply.summary, marketOpen = open)
    }

    /** Net worth across every asset class, and the asset sections when the scope holds any; a failure hides them. */
    private suspend fun loadOverview(withAssets: Boolean) {
        try {
            val overview = ledger.view("overview.view")
            val assets = if (withAssets) ledger.view("assets.view") else null
            _ui.value =
                _ui.value.copy(
                    overview = if (overview is JsonNull) null else decodeView(AccountOverview.serializer(), overview),
                    assets = assets?.let { decodeView(AssetsView.serializer(), it) } ?: AssetsView(),
                )
        } catch (ignored: EngineException) {
            _ui.value = _ui.value.copy(overview = null, assets = AssetsView())
        } catch (ignored: SerializationException) {
            _ui.value = _ui.value.copy(overview = null, assets = AssetsView())
        }
    }

    /** The SIP card: where this month stands. Without a blueprint the card invites you to set one up. */
    private suspend fun loadSip() {
        try {
            _ui.value = _ui.value.copy(sip = decodeView(SipView.serializer(), ledger.view("sip.view")))
        } catch (ignored: EngineException) {
            _ui.value = _ui.value.copy(sip = null)
        } catch (ignored: SerializationException) {
            _ui.value = _ui.value.copy(sip = null)
        }
    }
}
