package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ActivityEntry
import app.sipwise.model.CompanyView
import app.sipwise.model.DividendRow
import app.sipwise.model.HistoryRange
import app.sipwise.model.HistorySeries
import app.sipwise.model.splitEntryId
import app.sipwise.model.voidKind
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class CompanyTab { LEDGER, DIVIDENDS }

/** A sheet or dialog open over the company page. */
sealed interface CompanyDialog {
    data object Price : CompanyDialog

    data class Received(val row: DividendRow) : CompanyDialog

    data class Void(val entry: ActivityEntry) : CompanyDialog
}

data class CompanyUi(
    val view: CompanyView? = null,
    val range: HistoryRange = HistoryRange.MONTH,
    val series: HistorySeries? = null,
    val historyLoading: Boolean = true,
    val historyError: String? = null,
    val tab: CompanyTab = CompanyTab.LEDGER,
    val dialog: CompanyDialog? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/** One company: position, price chart, ledger and dividends. The numbers come from the shared TypeScript. */
class CompanyViewModel(
    private val ledger: Ledger,
    private val api: ApiClient,
    private val ticker: String,
) : ViewModel() {
    private val _ui = MutableStateFlow(CompanyUi())
    val ui: StateFlow<CompanyUi> = _ui.asStateFlow()
    private var rawHistory: String? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
        loadHistory()
    }

    private suspend fun load() {
        try {
            val reply = ledger.engine.call("company.view", mapOf("ticker" to ticker))
            _ui.value = _ui.value.copy(view = ApiJson.decodeFromJsonElement(CompanyView.serializer(), reply))
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun loadHistory() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(historyLoading = true, historyError = null)
            try {
                val raw = api.get("/api/price-history?ticker=$ticker", JsonElement.serializer())
                rawHistory = raw.toString()
                _ui.value = _ui.value.copy(historyLoading = false)
                slice()
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(historyLoading = false, historyError = e.message)
            }
        }
    }

    private suspend fun slice() {
        val raw = rawHistory ?: return
        try {
            val reply = ledger.engine.call("history.series", mapOf("json" to raw, "range" to _ui.value.range.wire))
            _ui.value = _ui.value.copy(series = ApiJson.decodeFromJsonElement(HistorySeries.serializer(), reply))
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(historyError = e.message)
        }
    }

    fun setRange(range: HistoryRange) {
        _ui.value = _ui.value.copy(range = range)
        viewModelScope.launch { slice() }
    }

    fun setTab(tab: CompanyTab) {
        _ui.value = _ui.value.copy(tab = tab)
    }

    fun open(dialog: CompanyDialog?) {
        _ui.value = _ui.value.copy(dialog = dialog, error = null)
    }

    fun savePrice(
        portfolioId: String,
        price: String,
        date: String,
    ) = change(portfolioId, "price", LedgerAction.PRICE) {
        put("ticker", ticker)
        put("price", price)
        put("date", date)
    }

    fun markReceived(
        row: DividendRow,
        paymentDate: String,
        gross: String,
        tax: String,
    ) {
        val (portfolio, id) = splitEntryId(row.id, soleWritable())
        change(portfolio, "received", LedgerAction.RECEIVED) {
            put("id", id)
            put("paymentDate", paymentDate)
            put("grossAmount", gross)
            put("taxWithheld", tax)
        }
    }

    fun voidEntry(entry: ActivityEntry) {
        val (portfolio, id) = splitEntryId(entry.id, soleWritable())
        change(portfolio, "void", LedgerAction.VOID) {
            put("entryKind", voidKind(entry.kind))
            put("id", id)
        }
    }

    private fun soleWritable(): String =
        _ui.value.view?.portfolios?.firstOrNull { !it.locked }?.id.orEmpty()

    private fun change(
        portfolioId: String,
        op: String,
        action: LedgerAction,
        params: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.apply(portfolioId, op, buildJsonObject(params), ticker = ticker, action = action)
                _ui.value = _ui.value.copy(busy = false, dialog = null)
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
