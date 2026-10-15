package app.sipwise.ledger

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

/** Something the person just recorded, so the shell can say so and offer Undo. */
data class LedgerNotice(val kind: EntryKind?, val ticker: String, val change: SavedChange)

/**
 * The unlocked account as the screens see it: the calculation engine to read from, and one place to write through.
 * [version] changes after every committed change or undo, which is the screens' cue to read again.
 */
class Ledger(val engine: EngineClient, private val writer: LedgerWriter) {
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()
    private val _notices = MutableSharedFlow<LedgerNotice>(extraBufferCapacity = 4)
    val notices: SharedFlow<LedgerNotice> = _notices.asSharedFlow()

    suspend fun apply(
        portfolioId: String,
        op: String,
        params: JsonObject,
        kind: EntryKind? = null,
        ticker: String = "",
    ) {
        val change = writer.apply(portfolioId, op, params)
        _version.value += 1
        _notices.tryEmit(LedgerNotice(kind, ticker, change))
    }

    suspend fun undo(change: SavedChange) {
        writer.undo(change)
        _version.value += 1
    }
}
