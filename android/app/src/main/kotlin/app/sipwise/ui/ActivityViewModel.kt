package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.ActivityFilter
import app.sipwise.model.ActivityView
import app.sipwise.session.EngineException
import app.sipwise.session.decodeView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ActivityUi(
    val view: ActivityView? = null,
    val filter: ActivityFilter = ActivityFilter.ALL,
    val query: String = "",
    val error: String? = null,
)

/** The Activity ledger: filtering, search and month grouping run in the shared TypeScript. */
class ActivityViewModel(private val ledger: Ledger) : ViewModel() {
    private var job: Job? = null
    private val _ui = MutableStateFlow(ActivityUi())
    val ui: StateFlow<ActivityUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    fun setFilter(filter: ActivityFilter) {
        _ui.value = _ui.value.copy(filter = filter)
        load()
    }

    fun setQuery(query: String) {
        _ui.value = _ui.value.copy(query = query)
        load()
    }

    private fun load() {
        job?.cancel()
        job =
            viewModelScope.launch {
                val current = _ui.value
                try {
                    val reply = ledger.view("activity.view", mapOf("filter" to current.filter.wire, "query" to current.query))
                    _ui.value = _ui.value.copy(view = decodeView(ActivityView.serializer(), reply), error = null)
                } catch (e: EngineException) {
                    _ui.value = _ui.value.copy(error = e.message)
                }
            }
    }
}
