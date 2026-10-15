package app.sipwise.ledger

import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.EntryKind
import app.sipwise.session.EngineClient
import app.sipwise.session.LedgerWriter
import app.sipwise.session.SavedChange
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject

/** What kind of change was saved, so the notice can say it in words. */
enum class LedgerAction { ENTRY, PRICE, RECEIVED, VOID, BUYS, BUDGET, TARGETS, CORRECTION }

/** Something the person just recorded, so the shell can say so and offer Undo. */
data class LedgerNotice(val kind: EntryKind?, val ticker: String, val change: SavedChange, val action: LedgerAction = LedgerAction.ENTRY)

/**
 * The unlocked account as the screens see it: the calculation engine to read from, and one place to write through.
 * [version] changes after every committed change or undo, which is the screens' cue to read again.
 */
class Ledger(val engine: EngineClient, private val writer: LedgerWriter) {
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()
    private val _scope = MutableStateFlow(ALL_PORTFOLIOS)

    /** Which portfolio the screens show: [ALL_PORTFOLIOS] or one portfolio id. Kept only while unlocked. */
    val scope: StateFlow<String> = _scope.asStateFlow()

    fun select(id: String) {
        if (_scope.value == id) return
        _scope.value = id
        _version.value += 1
    }

    /** An engine read for the selected portfolio (or all of them). */
    suspend fun view(
        name: String,
        args: Map<String, String> = emptyMap(),
    ) = engine.call(name, args + ("scope" to _scope.value))

    private val _notices = MutableSharedFlow<LedgerNotice>(extraBufferCapacity = 4)
    val notices: SharedFlow<LedgerNotice> = _notices.asSharedFlow()

    suspend fun apply(
        portfolioId: String,
        op: String,
        params: JsonObject,
        kind: EntryKind? = null,
        ticker: String = "",
        action: LedgerAction = LedgerAction.ENTRY,
    ) {
        val change = writer.apply(portfolioId, op, params)
        _version.value += 1
        _notices.tryEmit(LedgerNotice(kind, ticker, change, action))
    }

    suspend fun undo(change: SavedChange) {
        writer.undo(change)
        _version.value += 1
    }
}
