package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.InsightsView
import app.sipwise.model.TrackRange
import app.sipwise.model.TrackView
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.EngineException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException

data class InsightsUi(
    val report: InsightsView? = null,
    val track: TrackView? = null,
    val trackEmpty: Boolean = false,
    val trackLoading: Boolean = false,
    val trackError: String? = null,
    val range: TrackRange = TrackRange.YEAR,
    val error: String? = null,
)

/** Insights: the report sections plus the value-vs-money-in, return and KSE-100 comparison built from price history. */
class InsightsViewModel(
    private val ledger: Ledger,
    private val api: ApiClient,
) : ViewModel() {
    private val _ui = MutableStateFlow(InsightsUi())
    val ui: StateFlow<InsightsUi> = _ui.asStateFlow()
    private val histories = TrackHistories(ledger, api)
    private var trackJob: Job? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            val report = ApiJson.decodeFromJsonElement(InsightsView.serializer(), ledger.view("insights.view"))
            _ui.value = _ui.value.copy(report = report, error = null)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        } catch (e: SerializationException) {
            _ui.value = _ui.value.copy(error = e.javaClass.simpleName)
        }
        loadTrack()
    }

    fun setRange(range: TrackRange) {
        _ui.value = _ui.value.copy(range = range)
        loadTrack()
    }

    fun retry() {
        loadTrack(force = true)
    }

    private fun loadTrack(force: Boolean = false) {
        trackJob?.cancel()
        trackJob =
            viewModelScope.launch {
                _ui.value = _ui.value.copy(trackLoading = true, trackError = null)
                try {
                    val closes = histories.load(force)
                    if (closes == null) {
                        _ui.value = _ui.value.copy(trackEmpty = true, track = null, trackLoading = false)
                        return@launch
                    }
                    val args = mapOf("range" to _ui.value.range.key, "histories" to closes.full)
                    val track = ApiJson.decodeFromJsonElement(TrackView.serializer(), ledger.view("track.view", args))
                    _ui.value = _ui.value.copy(track = track, trackEmpty = false, trackLoading = false)
                } catch (e: EngineException) {
                    _ui.value = _ui.value.copy(trackLoading = false, trackError = e.message)
                } catch (e: ApiRequestException) {
                    _ui.value = _ui.value.copy(trackLoading = false, trackError = e.message)
                } catch (e: SerializationException) {
                    _ui.value = _ui.value.copy(trackLoading = false, trackError = e.javaClass.simpleName)
                }
            }
    }
}
