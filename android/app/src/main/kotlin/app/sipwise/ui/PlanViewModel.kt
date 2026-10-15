package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.PlanRow
import app.sipwise.model.PlanView
import app.sipwise.model.ReviewResult
import app.sipwise.model.ReviewRow
import app.sipwise.model.shiftMonth
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The review sheet: typed text per suggested buy, which are left out, and the live total. */
data class ReviewState(
    val rows: List<ReviewRow>,
    val excluded: Set<String> = emptySet(),
    val result: ReviewResult = ReviewResult(),
    val error: String? = null,
)

data class PlanUi(
    val view: PlanView? = null,
    val month: String? = null,
    val fee: String = "0",
    val allowOld: Boolean = false,
    val receiverId: String? = null,
    val editingBudget: Boolean = false,
    val review: ReviewState? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/** The Plan tab in targets mode. The shared TypeScript builds the plan; this holds the choices and the sheets. */
class PlanViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(PlanUi())
    val ui: StateFlow<PlanUi> = _ui.asStateFlow()
    private var loadJob: Job? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private fun load() {
        loadJob?.cancel()
        loadJob =
            viewModelScope.launch {
                val current = _ui.value
                val args = mutableMapOf("feePct" to current.fee, "allowOld" to current.allowOld.toString())
                current.month?.let { args["month"] = it }
                try {
                    val view = ApiJson.decodeFromJsonElement(PlanView.serializer(), ledger.engine.call("plan.view", args))
                    _ui.value = _ui.value.copy(view = view, month = view.month, error = null)
                } catch (e: EngineException) {
                    _ui.value = _ui.value.copy(error = e.message)
                }
            }
    }

    fun shift(delta: Int) {
        val month = _ui.value.month ?: return
        _ui.value = _ui.value.copy(month = shiftMonth(month, delta))
        load()
    }

    fun setFee(fee: String) {
        _ui.value = _ui.value.copy(fee = fee)
        load()
    }

    fun setAllowOld(allow: Boolean) {
        _ui.value = _ui.value.copy(allowOld = allow)
        load()
    }

    fun setReceiver(id: String) {
        _ui.value = _ui.value.copy(receiverId = id)
    }

    fun editBudget(open: Boolean) {
        _ui.value = _ui.value.copy(editingBudget = open, error = null)
    }

    fun saveBudget(amount: String) {
        val view = _ui.value.view ?: return
        change(view.homeId, "budget", LedgerAction.BUDGET, view.month) {
            put("month", view.month)
            put("amount", amount)
        }
    }

    fun openReview() {
        val view = _ui.value.view ?: return
        val rows = view.buys.map { ReviewRow(it.ticker, it.name, it.shares.toLong().toString(), it.price?.toString().orEmpty()) }
        _ui.value = _ui.value.copy(review = ReviewState(rows), error = null)
        recalc()
    }

    fun closeReview() {
        _ui.value = _ui.value.copy(review = null, error = null)
    }

    fun editRow(
        ticker: String,
        shares: String? = null,
        price: String? = null,
    ) {
        val review = _ui.value.review ?: return
        val rows = review.rows.map { if (it.ticker == ticker) it.copy(shares = shares ?: it.shares, price = price ?: it.price) else it }
        _ui.value = _ui.value.copy(review = review.copy(rows = rows))
        recalc()
    }

    fun toggleRow(ticker: String) {
        val review = _ui.value.review ?: return
        val excluded = if (ticker in review.excluded) review.excluded - ticker else review.excluded + ticker
        _ui.value = _ui.value.copy(review = review.copy(excluded = excluded))
        recalc()
    }

    private fun recalc() {
        viewModelScope.launch {
            val review = _ui.value.review ?: return@launch
            val included = review.rows.filter { it.ticker !in review.excluded }
            try {
                val args = mapOf("rows" to ApiJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ReviewRow.serializer()), included), "feePct" to _ui.value.fee)
                val result = ApiJson.decodeFromJsonElement(ReviewResult.serializer(), ledger.engine.call("buys.review", args))
                _ui.value.review?.let { _ui.value = _ui.value.copy(review = it.copy(result = result)) }
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    fun record() {
        val ui = _ui.value
        val view = ui.view ?: return
        val review = ui.review ?: return
        val included = review.rows.filter { it.ticker !in review.excluded }
        val receiver = ui.receiverId ?: view.receivers.firstOrNull { it.id == view.homeId }?.id ?: view.homeId
        change(receiver, "buys", LedgerAction.BUYS, view.month) {
            put(
                "rows",
                buildJsonArray {
                    for (row in included) {
                        add(
                            buildJsonObject {
                                put("ticker", row.ticker)
                                put("name", row.name)
                                put("shares", row.shares)
                                put("price", row.price)
                            },
                        )
                    }
                },
            )
            put("feePct", ui.fee)
            put("month", view.month)
            put("note", "SIP")
        }
    }

    private fun change(
        portfolioId: String,
        op: String,
        action: LedgerAction,
        label: String,
        params: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        viewModelScope.launch {
            if (_ui.value.busy) return@launch
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.apply(portfolioId, op, buildJsonObject(params), ticker = label, action = action)
                _ui.value = _ui.value.copy(busy = false, editingBudget = false, review = null)
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

    /** The plan rows that can be recorded, for the "record only X" shortcut later. */
    fun suggestions(): List<PlanRow> = _ui.value.view?.buys.orEmpty()
}
