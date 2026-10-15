package app.sipwise.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class EntryCompany(val ticker: String, val name: String, val sector: String = "")

@Serializable
data class EntryPortfolio(
    val id: String,
    val name: String,
    val locked: Boolean = false,
    val companies: List<EntryCompany> = emptyList(),
)

/** What the add-entry form offers. Produced by the shared TypeScript (`entry.options`). */
@Serializable
data class EntryOptions(val today: String, val month: String, val portfolios: List<EntryPortfolio>)

/** Live totals under the form, e.g. "Total cost including fees". */
@Serializable
data class EntryTotals(val gross: Double, val fees: Double, val total: Double, val label: String)

enum class EntryKind(val wire: String) {
    BUY("buy"),
    SELL("sell"),
    OPENING("opening"),
    DIVIDEND("dividend"),
    SPLIT("split"),
    ;

    companion object {
        fun fromWire(wire: String): EntryKind? = entries.firstOrNull { it.wire == wire }
    }
}

/** An existing entry as the form needs it to correct or void it (`entry.get`). */
@Serializable
data class EntryDetail(
    val found: Boolean,
    val portfolioId: String = "",
    val id: String = "",
    val readOnly: String? = null,
    val entryKind: String = "",
    val kind: String = "",
    val ticker: String = "",
    val date: String = "",
    val shares: String = "",
    val price: String = "",
    val fees: String = "",
    val month: String = "",
    val note: String = "",
    val perShare: String = "",
    val oldShares: String = "",
    val newShares: String = "",
) {
    fun toForm() =
        EntryForm(
            kind = EntryKind.fromWire(kind) ?: EntryKind.BUY,
            portfolioId = portfolioId,
            ticker = ticker,
            date = date,
            shares = shares,
            price = price,
            fees = fees,
            month = month,
            note = note,
            perShare = perShare,
            oldShares = oldShares,
            newShares = newShares,
            editingId = id,
        )
}

/** The form exactly as typed. The shared TypeScript parses and validates the text, so messages match the other apps. */
data class EntryForm(
    val kind: EntryKind = EntryKind.BUY,
    val portfolioId: String = "",
    val ticker: String = "",
    val date: String = "",
    val shares: String = "",
    val price: String = "",
    val fees: String = "",
    val month: String = "",
    val note: String = "",
    val perShare: String = "",
    val oldShares: String = "",
    val newShares: String = "",
    val editingId: String? = null,
)

/** The ledger operation name and its parameters for [form]. */
fun entryOperation(form: EntryForm): Pair<String, JsonObject> {
    val op =
        when (form.kind) {
            EntryKind.DIVIDEND -> "dividend"
            EntryKind.SPLIT -> "split"
            else -> "trade"
        }
    val params =
        buildJsonObject {
            put("ticker", form.ticker)
            put("date", form.date)
            put("note", form.note)
            form.editingId?.let { put("editingId", it) }
            when (form.kind) {
                EntryKind.DIVIDEND -> put("perShare", form.perShare)
                EntryKind.SPLIT -> {
                    put("oldShares", form.oldShares)
                    put("newShares", form.newShares)
                }
                else -> {
                    put("kind", form.kind.wire)
                    put("shares", form.shares)
                    put("price", form.price)
                    put("fees", form.fees)
                    put("month", if (form.kind == EntryKind.BUY) form.month else "")
                }
            }
        }
    return op to params
}
