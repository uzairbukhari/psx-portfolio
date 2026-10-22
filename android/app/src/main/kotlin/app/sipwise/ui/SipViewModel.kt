package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ScopeList
import app.sipwise.model.SipClass
import app.sipwise.model.SipLevers
import app.sipwise.model.SipPreview
import app.sipwise.model.SipProjection
import app.sipwise.model.SipRebalance
import app.sipwise.model.SipView
import app.sipwise.model.SipWhatIf
import app.sipwise.model.SipWhatIfPreset
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import app.sipwise.session.decodeView
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A sheet open over the SIP Blueprint. */
sealed interface SipSheet {
    /** The whole plan: budget, split, SIP day, rebalance and reminders. */
    data object Edit : SipSheet

    /** Where this plan lands over the years. */
    data object Future : SipSheet

    /** A gold or currency purchase to record for one row. */
    data class Log(val key: SipClass, val amount: Double, val rate: Double?) : SipSheet

    /** Move one class's amount for this month, spreading the difference over the rows not yet ticked. */
    data class Move(val key: SipClass, val amount: Double) : SipSheet
}

/** What the setup wizard and the edit sheet have in hand before it is saved. */
data class SipDraft(
    val budget: Double,
    val targets: Map<String, Double>,
    val strict: Boolean = false,
    val day: Int = 1,
    val notify: Boolean = true,
    val preset: String = "balanced",
)

/** "I want [target] rupees, by [year] (optional)". */
data class SipGoalQuery(val target: Double, val year: Int? = null)

/** A what-if being built: which one (an existing index, or the next free one) and the changes so far. */
data class SipBuilder(val index: Int, val levers: SipLevers = SipLevers())

/** What the Future you sheet has asked the engine: the plan's inputs, the what-ifs on top and an optional goal. */
data class SipFutureQuery(
    val monthly: Double? = null,
    val years: Int = SipViewModel.DEFAULT_YEARS,
    val stepUp: Double? = null,
    val fromHoldings: Boolean = true,
    val real: Boolean = false,
    val whatIfs: List<SipWhatIf> = emptyList(),
    val goal: SipGoalQuery? = null,
    val builder: SipBuilder? = null,
)

data class SipUi(
    val view: SipView? = null,
    /** The live answer for the draft in the wizard or the edit sheet. */
    val preview: SipPreview? = null,
    val draft: SipDraft? = null,
    val step: Int = 0,
    val projection: SipProjection? = null,
    val future: SipFutureQuery = SipFutureQuery(),
    val sheet: SipSheet? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/**
 * The SIP Blueprint: this month's plan, what is done, the habit and where it leads. Every figure comes from the
 * shared TypeScript (`sip.view`, `sip.preview`, `sip.project`), so the phone and the web say the same thing.
 */
class SipViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(SipUi())
    val ui: StateFlow<SipUi> = _ui.asStateFlow()
    private var previewJob: Job? = null
    private var projectJob: Job? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            findWritable()
            val view = decodeView(SipView.serializer(), ledger.engine.call("sip.view"))
            _ui.value = _ui.value.copy(view = view, error = null)
            if (view.setup && _ui.value.draft == null) startDraft(null)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    /** Opens the wizard (or the edit sheet) on the plan in force, or on the balanced preset when there is none. */
    fun startDraft(from: SipSheet?) {
        val view = _ui.value.view
        val b = view?.blueprint
        val blank = view?.blank
        val draft =
            if (b != null) {
                SipDraft(b.budget, b.targets, b.strict, b.day ?: 1, b.notify, preset = "custom")
            } else {
                val preset = view?.presets?.firstOrNull { it.key == "balanced" }
                SipDraft(
                    budget = blank?.budget ?: view?.budgetPills?.firstOrNull() ?: 0.0,
                    targets = preset?.targets ?: blank?.targets.orEmpty(),
                    day = blank?.day ?: 1,
                    notify = true,
                )
            }
        _ui.value = _ui.value.copy(draft = draft, step = 0, sheet = from)
        preview()
    }

    fun setDraft(change: (SipDraft) -> SipDraft) {
        val draft = _ui.value.draft ?: return
        _ui.value = _ui.value.copy(draft = change(draft), error = null)
        preview()
    }

    fun setStep(step: Int) {
        _ui.value = _ui.value.copy(step = step)
    }

    private fun preview() {
        val draft = _ui.value.draft ?: return
        previewJob?.cancel()
        previewJob =
            viewModelScope.launch {
                // A slider reports every frame; wait until the thumb settles so the engine is not asked for each one.
                delay(PREVIEW_DEBOUNCE_MS)
                val json =
                    buildJsonObject {
                        put("budget", draft.budget)
                        put(
                            "targets",
                            buildJsonObject { for ((k, v) in draft.targets) put(k, v) },
                        )
                        put("strict", draft.strict)
                    }
                try {
                    // Once asked, the engine finishes the call even if a newer one replaces it: cancelling a call in
                    // flight is not something the JavaScript sandbox is built for.
                    val reply = withContext(NonCancellable) { ledger.engine.call("sip.preview", mapOf("draft" to json.toString())) }
                    _ui.value = _ui.value.copy(preview = decodeView(SipPreview.serializer(), reply))
                } catch (ignored: EngineException) {
                    // The preview is a help, not a gate: the draft can still be saved and the engine validates it.
                }
            }
    }

    /**
     * "Future you": where this much a month, growing by the step-up, lands over the look-ahead, with the what-ifs and the
     * goal on top. [change] edits the question; the engine answers it again.
     */
    fun project(change: (SipFutureQuery) -> SipFutureQuery = { it }) {
        val query = change(_ui.value.future)
        _ui.value = _ui.value.copy(future = query)
        projectJob?.cancel()
        projectJob =
            viewModelScope.launch {
                delay(PREVIEW_DEBOUNCE_MS)
                val args =
                    buildMap {
                        put("years", query.years.toString())
                        query.monthly?.let { put("monthly", it.toString()) }
                        query.stepUp?.let { put("stepUp", it.toString()) }
                        put("startFromHoldings", query.fromHoldings.toString())
                        put("real", query.real.toString())
                        if (query.whatIfs.isNotEmpty()) {
                            put("whatIfs", LEVER_JSON.encodeToString(ListSerializer(SipWhatIf.serializer()), query.whatIfs))
                        }
                        query.goal?.let { g ->
                            val goal =
                                buildJsonObject {
                                    put("target", g.target)
                                    g.year?.let { put("year", it) }
                                }
                            put("goal", goal.toString())
                        }
                    }
                try {
                    val reply = withContext(NonCancellable) { ledger.engine.call("sip.project", args) }
                    _ui.value = _ui.value.copy(projection = decodeView(SipProjection.serializer(), reply))
                } catch (e: EngineException) {
                    _ui.value = _ui.value.copy(error = e.message)
                }
            }
    }

    /** Puts a ready-made what-if on the chart, or takes it off again. At most two at a time. */
    fun togglePreset(preset: SipWhatIfPreset) =
        project { q ->
            val on = q.whatIfs.any { it.key == preset.key }
            val next =
                when {
                    on -> q.whatIfs.filterNot { it.key == preset.key }
                    q.whatIfs.size < MAX_WHAT_IFS -> q.whatIfs + SipWhatIf(preset.key, preset.levers, preset.label)
                    else -> q.whatIfs
                }
            q.copy(whatIfs = next)
        }

    fun removeWhatIf(key: String) = project { q -> q.copy(whatIfs = q.whatIfs.filterNot { it.key == key }) }

    fun openBuilder(index: Int) =
        project { q -> q.copy(builder = SipBuilder(index, q.whatIfs.getOrNull(index)?.levers ?: SipLevers())) }

    fun editBuilder(levers: SipLevers) = project { q -> q.copy(builder = q.builder?.copy(levers = levers)) }

    fun cancelBuilder() = project { q -> q.copy(builder = null) }

    /** Puts what the builder holds on the chart (replacing the one it was editing). */
    fun applyBuilder() =
        project { q ->
            val b = q.builder ?: return@project q
            val made = SipWhatIf("custom-${b.index}-${b.levers.hashCode()}", b.levers)
            val rest = q.whatIfs.filterIndexed { i, _ -> i != b.index }
            q.copy(whatIfs = (rest.take(b.index) + made + rest.drop(b.index)).take(MAX_WHAT_IFS), builder = null)
        }

    fun setGoal(goal: SipGoalQuery?) = project { q -> q.copy(goal = goal) }

    fun open(sheet: SipSheet?) {
        _ui.value = _ui.value.copy(sheet = sheet, error = null)
        if (sheet == SipSheet.Future) project()
        if (sheet == SipSheet.Edit) startDraft(SipSheet.Edit)
    }

    /** The whole plan from the wizard or the edit sheet. */
    fun save() {
        val draft = _ui.value.draft ?: return
        val view = _ui.value.view
        val blueprint =
            buildJsonObject {
                put("budget", draft.budget)
                put("targets", buildJsonObject { for ((k, v) in draft.targets) put(k, v) })
                put("day", draft.day)
                put("strict", draft.strict)
                put("notify", draft.notify)
                put("preset", draft.preset)
                // `since` is a month ("2026-10"), not a day.
                put("since", view?.blueprint?.since?.takeIf { it.isNotEmpty() } ?: view?.month?.takeIf { it.isNotEmpty() } ?: view?.asOf.orEmpty().take(MONTH_LENGTH))
                view?.blueprint?.stepUp?.let { put("stepUp", it) }
                put("months", buildJsonObject { })
            }
        change("sip.save") {
            put("blueprint", blueprint.toString())
            put("month", view?.hero?.month ?: view?.month.orEmpty())
        }
    }

    /** Ticks a class off by hand (a logged purchase is read from the ledger instead). */
    fun markDone(
        key: SipClass,
        amount: Double,
        date: String,
    ) = monthChange("sip.done", key) {
        put("amount", amount)
        put("date", date)
    }

    fun markUndone(key: SipClass) = monthChange("sip.undone", key) {}

    /** One stepper move, with the difference spread over the rows that are not done. */
    fun movePlan(
        key: SipClass,
        amount: Double,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                val reply =
                    ledger.engine.call(
                        "sip.rebalance",
                        mapOf("class" to key.wire, "amount" to amount.toString()),
                    )
                val next = decodeView(SipRebalance.serializer(), reply)
                val month = _ui.value.view?.hero?.month.orEmpty()
                ledger.applyAccount(
                    "sip.plan",
                    buildJsonObject {
                        put("month", month)
                        put("class", key.wire)
                        put("amount", amount)
                        put("plan", buildJsonObject { for ((k, v) in next.plan) put(k, v) }.toString())
                    },
                    label = "SIP",
                    action = LedgerAction.BUDGET,
                    notify = false,
                )
                _ui.value = _ui.value.copy(busy = false, sheet = null)
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

    fun setStrict(strict: Boolean) = monthOnly("sip.strict") { put("strict", strict) }

    fun setNotify(notify: Boolean) = monthOnly("sip.notify") { put("notify", notify) }

    /** Starts the month's plan again from what the blueprint suggests, dropping this month's hand edits. */
    fun resetPlan() {
        val suggested = _ui.value.view?.state?.suggested ?: return
        monthOnly("sip.resetPlan") { put("plan", buildJsonObject { for ((k, v) in suggested) put(k, v) }.toString()) }
    }

    /** A gold or currency purchase recorded against the first portfolio that can be written to. */
    fun logPurchase(
        key: SipClass,
        amount: Double,
        units: Double,
        date: String,
        currency: String = "USD",
    ) {
        val portfolio = writable
        if (portfolio == null) {
            fail("Every portfolio is locked, so nothing can be recorded.")
            return
        }
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.apply(
                    portfolio,
                    "sip.log",
                    buildJsonObject {
                        put("class", key.wire)
                        put("date", date)
                        put("amount", amount)
                        if (key == SipClass.GOLD) put("grams", units) else put("units", units)
                        if (key == SipClass.CURRENCY) put("currency", currency)
                    },
                    action = LedgerAction.ENTRY,
                )
                _ui.value = _ui.value.copy(busy = false, sheet = null)
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

    /** The portfolio a logged purchase goes into: the first one that is not locked. */
    private var writable: String? = null

    private suspend fun findWritable() {
        if (writable != null) return
        writable =
            try {
                decodeView(ScopeList.serializer(), ledger.engine.call("scope.list"))
                    .portfolios
                    .firstOrNull { !it.locked }
                    ?.id
            } catch (ignored: EngineException) {
                null
            }
    }

    private fun monthChange(
        op: String,
        key: SipClass,
        params: JsonObjectBuilder.() -> Unit,
    ) = change(op) {
        put("month", _ui.value.view?.hero?.month.orEmpty())
        put("class", key.wire)
        put("plan", buildJsonObject { for ((k, v) in _ui.value.view?.state?.plan.orEmpty()) put(k, v) }.toString())
        _ui.value.view?.state?.budget?.let { put("budget", it) }
        params()
    }

    private fun monthOnly(
        op: String,
        params: JsonObjectBuilder.() -> Unit,
    ) = change(op) {
        put("month", _ui.value.view?.hero?.month ?: _ui.value.view?.month.orEmpty())
        params()
    }

    private fun change(
        op: String,
        params: JsonObjectBuilder.() -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.applyAccount(op, buildJsonObject(params), label = "SIP", action = LedgerAction.BUDGET, notify = false)
                _ui.value = _ui.value.copy(busy = false, sheet = null, draft = null)
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

    companion object {
        const val DEFAULT_YEARS = 15
        const val MAX_WHAT_IFS = 2
        private val LEVER_JSON = Json { explicitNulls = false }
        const val PREVIEW_DEBOUNCE_MS = 120L
        const val MONTH_LENGTH = 7
    }
}
