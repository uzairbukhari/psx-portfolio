package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.ScopeList
import app.sipwise.model.ScopePortfolio
import app.sipwise.session.EngineException
import app.sipwise.session.decodeView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The portfolio chooser: which portfolios exist and which one the screens show. */
class ScopeViewModel(private val ledger: Ledger) : ViewModel() {
    private val _portfolios = MutableStateFlow<List<ScopePortfolio>>(emptyList())
    val portfolios: StateFlow<List<ScopePortfolio>> = _portfolios.asStateFlow()
    val selected: StateFlow<String> = ledger.scope

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            _portfolios.value = decodeView(ScopeList.serializer(), ledger.engine.call("scope.list")).portfolios
        } catch (ignored: EngineException) {
            // The screens report their own errors; the chooser simply stays as it was.
        }
    }

    fun select(id: String) = ledger.select(id)
}
