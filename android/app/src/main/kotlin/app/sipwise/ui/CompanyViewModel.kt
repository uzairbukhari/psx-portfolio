package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ActivityFilter
import app.sipwise.model.CompanyQuoteRow
import app.sipwise.model.CompanyStats
import app.sipwise.model.CompanyView
import app.sipwise.model.DividendRow
import app.sipwise.model.HistoryRange
import app.sipwise.model.HistorySeries
import app.sipwise.model.MarketSummaryResponse
import app.sipwise.model.splitEntryId
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import app.sipwise.session.decodeView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

enum class CompanyTab { LEDGER, DIVIDENDS }

/** A sheet or dialog open over the company page. */
sealed interface CompanyDialog {
    data object Price : CompanyDialog

    data object Actions : CompanyDialog

    data object Edit : CompanyDialog

    data object Symbol : CompanyDialog

    data class Received(val row: DividendRow) : CompanyDialog
}

data class CompanyUi(
    val view: CompanyView? = null,
    val range: HistoryRange = HistoryRange.MONTH,
    val series: HistorySeries? = null,
    val historyLoading: Boolean = true,
    val historyError: String? = null,
    /** The key statistics, formatted by the engine from public data only. */
    val stats: CompanyStats? = null,
    val day: CompanyQuoteRow? = null,
    val tab: CompanyTab = CompanyTab.LEDGER,
    val filter: ActivityFilter = ActivityFilter.ALL,
    val dialog: CompanyDialog? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/**
 * One company: position, price chart with your buys and sales on it, the public key statistics, dividends and the
 * ledger. Every figure comes from the shared TypeScript, so the page says what the web page says.
 */
class CompanyViewModel(
    private val ledger: Ledger,
    private val api: ApiClient,
    private val ticker: String,
) : ViewModel() {
    private val _ui = MutableStateFlow(CompanyUi())
    val ui: StateFlow<CompanyUi> = _ui.asStateFlow()
    private var rawHistory: String? = null
    private var rawStats: String? = null

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
        loadHistory()
        loadStats()
    }

    private suspend fun load() {
        try {
            val reply = ledger.view("company.view", mapOf("ticker" to ticker))
            _ui.value = _ui.value.copy(view = decodeView(CompanyView.serializer(), reply))
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
                stats()
            } catch (e: ApiRequestException) {
                _ui.value = _ui.value.copy(historyLoading = false, historyError = e.message)
            }
        }
    }

    /**
     * The public key statistics: the company-stats cache and this symbol's day quote from the shared market cache.
     * Only the symbol leaves the device, as everywhere else.
     */
    fun loadStats() {
        viewModelScope.launch {
            val encoded = URLEncoder.encode(ticker, "UTF-8")
            rawStats =
                try {
                    api.get("/api/company-stats?ticker=$encoded", JsonElement.serializer()).toString()
                } catch (ignored: ApiRequestException) {
                    null
                }
            val day =
                try {
                    api
                        .get("/api/market-summary?tickers=$encoded", MarketSummaryResponse.serializer())
                        .summary
                        ?.companies
                        ?.firstOrNull { it.ticker.equals(ticker, ignoreCase = true) }
                } catch (ignored: ApiRequestException) {
                    null
                }
            _ui.value = _ui.value.copy(day = day)
            stats()
        }
    }

    private suspend fun stats() {
        val args =
            buildMap {
                put("ticker", ticker)
                rawStats?.let { put("stats", it) }
                rawHistory?.let { put("history", it) }
                _ui.value.day?.let { row ->
                    put(
                        "day",
                        buildJsonObject {
                            put("price", row.price)
                            put("high", row.high)
                            put("low", row.low)
                            put("volume", row.volume)
                            put("previousClose", row.previousClose)
                        }.toString(),
                    )
                }
            }
        try {
            val reply = ledger.engine.call("company.stats", args)
            _ui.value = _ui.value.copy(stats = decodeView(CompanyStats.serializer(), reply))
        } catch (ignored: EngineException) {
            // The statistics card is extra: without it the rest of the page still works.
        }
    }

    private suspend fun slice() {
        val raw = rawHistory ?: return
        try {
            val reply = ledger.engine.call("history.series", mapOf("json" to raw, "range" to _ui.value.range.wire))
            _ui.value = _ui.value.copy(series = decodeView(HistorySeries.serializer(), reply))
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

    fun setFilter(filter: ActivityFilter) {
        _ui.value = _ui.value.copy(filter = filter)
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

    /** The company's name and sector, in every portfolio that holds it. */
    fun saveCompany(
        name: String,
        sector: String,
    ) = eachPortfolio("company.edit", LedgerAction.CORRECTION) {
        put("ticker", ticker)
        put("name", name)
        put("sector", sector)
    }

    /** PSX renamed the company: every entry moves with the symbol, in one save per portfolio. */
    fun changeSymbol(to: String) =
        eachPortfolio("company.symbol", LedgerAction.CORRECTION) {
            put("ticker", ticker)
            put("to", to)
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

    private fun soleWritable(): String = _ui.value.view?.portfolios?.firstOrNull { !it.locked }?.id.orEmpty()

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

    /**
     * A change to the company record itself, applied to every unlocked portfolio that holds it: the saves run one
     * after the other, each with its own revision check, and the first failure stops the rest.
     */
    private fun eachPortfolio(
        op: String,
        action: LedgerAction,
        params: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        val targets = _ui.value.view?.portfolios?.filter { !it.locked }.orEmpty()
        if (targets.isEmpty()) {
            fail("Every portfolio holding $ticker is locked.")
            return
        }
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                for (target in targets) {
                    ledger.apply(target.id, op, buildJsonObject(params), ticker = ticker, action = action, notify = target == targets.first())
                }
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
