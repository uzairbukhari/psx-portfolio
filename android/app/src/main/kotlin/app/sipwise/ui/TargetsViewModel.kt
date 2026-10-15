package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.CompanySearch
import app.sipwise.model.TargetDraft
import app.sipwise.model.TargetsEval
import app.sipwise.model.TargetsView
import app.sipwise.model.bumpWeight
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class TargetsUi(
    val view: TargetsView? = null,
    val rows: List<TargetDraft> = emptyList(),
    val eval: TargetsEval? = null,
    val adding: Boolean = false,
    val query: String = "",
    val search: CompanySearch? = null,
    val busy: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

/** The targets editor. Totals, screening status and the save rules all come from the shared TypeScript. */
class TargetsViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(TargetsUi())
    val ui: StateFlow<TargetsUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                val view = ApiJson.decodeFromJsonElement(TargetsView.serializer(), ledger.engine.call("targets.view"))
                _ui.value = _ui.value.copy(view = view, rows = view.rows)
                evaluate()
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    private fun set(rows: List<TargetDraft>) {
        _ui.value = _ui.value.copy(rows = rows, error = null)
        viewModelScope.launch { evaluate() }
    }

    private suspend fun evaluate() {
        val rows = _ui.value.rows
        try {
            val args = mapOf("rows" to ApiJson.encodeToString(ListSerializer(TargetDraft.serializer()), rows))
            val eval = ApiJson.decodeFromJsonElement(TargetsEval.serializer(), ledger.engine.call("targets.eval", args))
            _ui.value = _ui.value.copy(eval = eval)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun patch(
        ticker: String,
        change: (TargetDraft) -> TargetDraft,
    ) = set(_ui.value.rows.map { if (it.ticker == ticker) change(it) else it })

    fun bump(
        ticker: String,
        delta: Int,
    ) = patch(ticker) { it.copy(weight = bumpWeight(it.weight, delta)) }

    fun remove(ticker: String) = set(_ui.value.rows.filterNot { it.ticker == ticker })

    fun add(ticker: String) {
        set(_ui.value.rows + TargetDraft(ticker, "", approved = false, screenDate = ""))
        _ui.value = _ui.value.copy(adding = false, query = "", search = null)
    }

    fun spreadEvenly() {
        viewModelScope.launch {
            val rows = _ui.value.rows
            try {
                val reply = ledger.engine.call("targets.even", mapOf("count" to rows.size.toString()))
                val weights = ApiJson.decodeFromJsonElement(ListSerializer(Double.serializer()), reply)
                set(rows.mapIndexed { i, r -> r.copy(weight = weights[i].toString().removeSuffix(".0")) })
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    fun openAdd(open: Boolean) {
        _ui.value = _ui.value.copy(adding = open, query = "", search = null)
        if (open) search("")
    }

    fun search(query: String) {
        _ui.value = _ui.value.copy(query = query)
        viewModelScope.launch {
            val taken = ApiJson.encodeToString(ListSerializer(String.serializer()), _ui.value.rows.map { it.ticker })
            try {
                val reply = ledger.engine.call("targets.search", mapOf("taken" to taken, "query" to query))
                _ui.value = _ui.value.copy(search = ApiJson.decodeFromJsonElement(CompanySearch.serializer(), reply))
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    fun save() {
        val view = _ui.value.view ?: return
        viewModelScope.launch {
            if (_ui.value.busy) return@launch
            _ui.value = _ui.value.copy(busy = true, error = null)
            val rows = _ui.value.rows
            try {
                val params =
                    buildJsonObject {
                        put(
                            "rows",
                            buildJsonArray {
                                for (r in rows) {
                                    add(
                                        buildJsonObject {
                                            put("ticker", r.ticker)
                                            put("weight", r.weight)
                                            put("approved", r.approved)
                                            put("screenDate", r.screenDate)
                                        },
                                    )
                                }
                            },
                        )
                    }
                ledger.apply(view.homeId, "targets", params, action = LedgerAction.TARGETS)
                _ui.value = _ui.value.copy(busy = false, saved = true)
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
}
