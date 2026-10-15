package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.PicksConfig
import app.sipwise.model.PicksProgress
import app.sipwise.model.PicksStale
import app.sipwise.model.PicksStep
import app.sipwise.model.PicksView
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.network.FactsRefreshRequest
import app.sipwise.network.FactsRefreshResponse
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

data class PicksUi(
    val view: PicksView? = null,
    val fee: String = "0",
    val amount: String? = null,
    val shortlist: List<String>? = null,
    val query: String = "",
    val progress: PicksProgress? = null,
    val confirming: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
) {
    /** The shortlist being edited: what the person changed, else what was saved. */
    val selected: List<String> get() = shortlist ?: view?.shortlist.orEmpty()
    val amountText: String get() = amount ?: view?.budget?.toLong()?.toString().orEmpty()
}

/**
 * Monthly Picks, run on the phone. The shared TypeScript ranks and sizes; this fetches the public company data for the
 * named tickers (the only thing that leaves the phone), waits for fresh PSX data when it is stale, and saves the
 * finished run into the encrypted portfolio.
 */
class PicksViewModel(
    private val ledger: Ledger,
    private val api: ApiClient,
    private val month: String,
) : ViewModel() {
    private val _ui = MutableStateFlow(PicksUi())
    val ui: StateFlow<PicksUi> = _ui.asStateFlow()
    private var loadJob: Job? = null
    private var runJob: Job? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private fun load() {
        loadJob?.cancel()
        loadJob =
            viewModelScope.launch {
                try {
                    val view = ApiJson.decodeFromJsonElement(PicksView.serializer(), ledger.engine.call("picks.view", mapOf("month" to month)))
                    _ui.value = _ui.value.copy(view = view)
                } catch (e: EngineException) {
                    _ui.value = _ui.value.copy(error = e.message)
                }
            }
    }

    fun setAmount(text: String) {
        _ui.value = _ui.value.copy(amount = text)
    }

    fun setFee(text: String) {
        _ui.value = _ui.value.copy(fee = text)
    }

    fun setQuery(text: String) {
        _ui.value = _ui.value.copy(query = text)
    }

    fun toggle(ticker: String) {
        val ui = _ui.value
        val max = ui.view?.max ?: return
        val next =
            when {
                ticker in ui.selected -> ui.selected - ticker
                ui.selected.size < max -> ui.selected + ticker
                else -> ui.selected
            }
        _ui.value = ui.copy(shortlist = next)
    }

    fun useTargets() {
        val view = _ui.value.view ?: return
        _ui.value = _ui.value.copy(shortlist = view.targeted)
    }

    fun clear() {
        _ui.value = _ui.value.copy(shortlist = emptyList())
    }

    fun confirm(open: Boolean) {
        _ui.value = _ui.value.copy(confirming = open, error = null)
    }

    fun start() {
        val ui = _ui.value
        val view = ui.view ?: return
        if (runJob?.isActive == true) return
        runJob =
            viewModelScope.launch {
                _ui.value = ui.copy(error = null, progress = PicksProgress(PicksStep.VALIDATING, total = ui.selected.size))
                try {
                    execute(view, ui)
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

    private suspend fun execute(
        view: PicksView,
        ui: PicksUi,
    ) {
        val shortlist = ui.selected
        val amount = ui.amountText
        val inputs =
            buildJsonObject {
                put("month", month)
                put("amount", amount)
                put("shortlist", buildJsonArray { shortlist.forEach { add(JsonPrimitive(it)) } })
            }
        // The shortlist and amount are remembered even if the run fails, like the Expo app.
        ledger.apply(view.portfolioId, "picksInputs", inputs, action = LedgerAction.PICKS, notify = false)
        val analysis = gather(shortlist)
        step(PicksStep.METRICS, shortlist.size, shortlist.size)
        step(PicksStep.ALLOCATING, shortlist.size, shortlist.size)
        val run =
            buildJsonObject {
                put("month", month)
                put("amount", amount)
                put("feePct", ui.fee)
                put("shortlist", buildJsonArray { shortlist.forEach { add(JsonPrimitive(it)) } })
                put("analysis", analysis)
            }
        ledger.apply(view.portfolioId, "picksRun", run, ticker = month, action = LedgerAction.PICKS)
        _ui.value = _ui.value.copy(progress = null)
    }

    /** Reads the public analysis, and when company data is stale asks for a scrape and waits for it (up to the limit). */
    private suspend fun gather(shortlist: List<String>): String {
        val config = ApiJson.decodeFromJsonElement(PicksConfig.serializer(), ledger.engine.call("picks.config"))
        step(PicksStep.GATHERING, 0, shortlist.size)
        var analysis = analysisFor(shortlist)
        val first = staleOf(analysis, emptyList())
        if (first.stale.isEmpty() || !first.dispatchEnabled) return analysis
        val requested =
            api.post("/api/recommendations", FactsRefreshRequest(first.stale), FactsRefreshRequest.serializer(), FactsRefreshResponse.serializer())
        if (!requested.waiting) return analysis
        val began = System.currentTimeMillis()
        var waiting = first.stale
        while (waiting.isNotEmpty()) {
            val elapsed = System.currentTimeMillis() - began
            _ui.value = _ui.value.copy(progress = PicksProgress(PicksStep.GATHERING, shortlist.size - waiting.size, shortlist.size, waiting))
            delay(if (elapsed < SLOW_AFTER_MS) config.pollFastMs else config.pollSlowMs)
            analysis = analysisFor(shortlist)
            waiting = staleOf(analysis, first.stale).waiting
            if (waiting.isNotEmpty() && System.currentTimeMillis() - began > config.gatherTimeoutMs) {
                _ui.value = _ui.value.copy(progress = PicksProgress(PicksStep.GATHERING, shortlist.size - waiting.size, shortlist.size, waiting, degraded = true))
                waiting = emptyList()
            }
        }
        return analysis
    }

    private suspend fun analysisFor(tickers: List<String>): String {
        val query = URLEncoder.encode(tickers.joinToString(","), "UTF-8")
        return api.get("/api/recommendations?tickers=$query", JsonElement.serializer()).toString()
    }

    private suspend fun staleOf(
        analysis: String,
        asked: List<String>,
    ): PicksStale {
        val args = mutableMapOf("json" to analysis)
        if (asked.isNotEmpty()) args["stale"] = buildJsonArray { asked.forEach { add(JsonPrimitive(it)) } }.toString()
        return ApiJson.decodeFromJsonElement(PicksStale.serializer(), ledger.engine.call("picks.stale", args))
    }

    private fun step(
        step: PicksStep,
        completed: Int,
        total: Int,
    ) {
        _ui.value = _ui.value.copy(progress = PicksProgress(step, completed, total))
    }

    private fun fail(message: String?) {
        _ui.value = _ui.value.copy(progress = null, busy = false, error = message)
    }

    /** Records every pick that has a price and whole shares as one set of buys, in the portfolio the picks belong to. */
    fun recordAll() {
        val ui = _ui.value
        val view = ui.view ?: return
        val rows = view.picks.filter { it.recordable }
        viewModelScope.launch {
            if (ui.busy) return@launch
            _ui.value = ui.copy(busy = true, error = null)
            try {
                val params =
                    buildJsonObject {
                        put(
                            "rows",
                            buildJsonArray {
                                for (row in rows) {
                                    add(
                                        buildJsonObject {
                                            put("ticker", row.ticker)
                                            put("name", row.name)
                                            put("shares", (row.shares ?: 0.0).toLong().toString())
                                            put("price", (row.price ?: 0.0).toString())
                                        },
                                    )
                                }
                            },
                        )
                        put("feePct", view.run?.feePct?.toString() ?: ui.fee)
                        put("month", month)
                        put("note", "Monthly Picks")
                    }
                ledger.apply(view.portfolioId, "buys", params, ticker = month, action = LedgerAction.BUYS)
                _ui.value = _ui.value.copy(busy = false, confirming = false)
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

    private companion object {
        const val SLOW_AFTER_MS = 60_000L
    }
}
