package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.EntryDetail
import app.sipwise.model.EntryForm
import app.sipwise.model.EntryKind
import app.sipwise.model.EntryOptions
import app.sipwise.model.EntryTotals
import app.sipwise.model.entryOperation
import app.sipwise.model.voidKind
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class EntryUi(
    val options: EntryOptions? = null,
    val editing: Boolean = false,
    val readOnly: String? = null,
    val missing: Boolean = false,
    val confirmVoid: Boolean = false,
    val form: EntryForm = EntryForm(),
    val totals: EntryTotals? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false,
)

/** The add-entry form. Parsing, validation and totals all come from the shared TypeScript; this holds the typed text. */
class EntryViewModel(
    private val ledger: Ledger,
    initial: EntryKind = EntryKind.BUY,
    private val editId: String? = null,
    private val initialTicker: String = "",
    private val initialShares: String = "",
    private val initialPrice: String = "",
) : ViewModel() {
    private val _ui = MutableStateFlow(EntryUi(form = EntryForm(kind = initial)))
    val ui: StateFlow<EntryUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                val options = ApiJson.decodeFromJsonElement(EntryOptions.serializer(), ledger.engine.call("entry.options"))
                if (editId != null) {
                    val detail = ApiJson.decodeFromJsonElement(EntryDetail.serializer(), ledger.engine.call("entry.get", mapOf("id" to editId)))
                    _ui.value =
                        if (detail.found) {
                            _ui.value.copy(options = options, editing = true, readOnly = detail.readOnly, form = detail.toForm())
                        } else {
                            _ui.value.copy(options = options, editing = true, missing = true)
                        }
                    refreshTotals(_ui.value.form)
                    return@launch
                }
                val writable = options.portfolios.firstOrNull { !it.locked }
                val owner = options.portfolios.firstOrNull { !it.locked && it.companies.any { c -> c.ticker == initialTicker } } ?: writable
                _ui.value =
                    _ui.value.copy(
                        options = options,
                        form =
                            _ui.value.form.copy(
                                portfolioId = owner?.id.orEmpty(),
                                ticker = if (owner?.companies?.any { it.ticker == initialTicker } == true) initialTicker else "",
                                date = options.today,
                                month = options.month,
                                shares = initialShares,
                                price = initialPrice,
                            ),
                    )
                refreshTotals(_ui.value.form)
            } catch (e: EngineException) {
                _ui.value = _ui.value.copy(error = e.message)
            }
        }
    }

    fun update(form: EntryForm) {
        _ui.value = _ui.value.copy(form = form, error = null)
        refreshTotals(form)
    }

    private fun refreshTotals(form: EntryForm) {
        if (form.kind == EntryKind.DIVIDEND || form.kind == EntryKind.SPLIT) {
            _ui.value = _ui.value.copy(totals = null)
            return
        }
        viewModelScope.launch {
            val args = mapOf("kind" to form.kind.wire, "shares" to form.shares, "price" to form.price, "fees" to form.fees)
            val reply = runCatching { ledger.engine.call("entry.totals", args) }.getOrNull()
            val totals = if (reply == null || reply is JsonNull) null else ApiJson.decodeFromJsonElement(EntryTotals.serializer(), reply)
            _ui.value = _ui.value.copy(totals = totals)
        }
    }

    fun submit() {
        val form = _ui.value.form
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            val (op, params) = entryOperation(form)
            try {
                ledger.apply(form.portfolioId, op, params, form.kind, form.ticker, if (_ui.value.editing) LedgerAction.CORRECTION else LedgerAction.ENTRY)
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

    fun askVoid(open: Boolean) {
        _ui.value = _ui.value.copy(confirmVoid = open, error = null)
    }

    fun confirmVoid() {
        val form = _ui.value.form
        val id = form.editingId ?: return
        val kind = voidKind(form.kind.wire)
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null, confirmVoid = false)
            try {
                val params =
                    buildJsonObject {
                        put("entryKind", kind)
                        put("id", id)
                    }
                ledger.apply(form.portfolioId, "void", params, form.kind, form.ticker, LedgerAction.VOID)
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
