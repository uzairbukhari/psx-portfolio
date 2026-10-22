package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ZakatView
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import app.sipwise.session.decodeView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class ZakatUi(
    val view: ZakatView? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/**
 * Zakat: the estimate for the open zakat year, what has been paid and what is left. Every figure comes from the shared
 * TypeScript (`zakat.view`), and every change goes through `zakat.*` account ops saved inside the encrypted portfolio.
 */
class ZakatViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(ZakatUi())
    val ui: StateFlow<ZakatUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            val view = decodeView(ZakatView.serializer(), ledger.engine.call("zakat.view"))
            _ui.value = _ui.value.copy(view = view, error = null)
            // The weekly estimate the chart on the web draws from; recorded quietly the first time the page opens in a week.
            if (!view.setup && view.canLog && view.recordTrail) {
                change("zakat.trail") {}
            }
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun setup(
        startDate: String,
        school: String,
        shares: String,
    ) = change("zakat.setup") {
        put("startDate", startDate)
        put("school", school)
        put("shares", shares)
    }

    fun addItem(
        kind: String,
        amount: String,
        note: String,
    ) = change("zakat.item") {
        put("kind", kind)
        put("amount", amount)
        put("note", note)
    }

    fun removeItem(id: String) = change("zakat.item.remove") { put("id", id) }

    fun pay(
        amount: String,
        date: String,
        kind: String,
        note: String,
    ) = change("zakat.payment") {
        put("amount", amount)
        put("date", date)
        put("kind", kind)
        put("note", note)
    }

    fun voidPayment(id: String) = change("zakat.payment.void") { put("id", id) }

    fun closeYear(carryExtra: Boolean) = change("zakat.close") { put("carryExtra", carryExtra) }

    fun stop() = change("zakat.remove") {}

    fun clearError() {
        _ui.value = _ui.value.copy(error = null)
    }

    private fun change(
        op: String,
        params: JsonObjectBuilder.() -> Unit,
    ) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                ledger.applyAccount(op, buildJsonObject(params), label = "Zakat", action = LedgerAction.BUDGET, notify = false)
                _ui.value = _ui.value.copy(busy = false)
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
