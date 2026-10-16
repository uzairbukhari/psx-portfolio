package app.sipwise.ui

import app.sipwise.ledger.Ledger
import app.sipwise.model.TrackBatches
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** The closes for the engine: every day for the value chart, and just the latest few per company for the day move. */
class HistoryData(
    val full: String,
    val recent: String,
)

/** Daily closes for the companies in the chosen scope, fetched once per set of tickers and shared by the value chart and the day move. */
class TrackHistories(
    private val ledger: Ledger,
    private val api: ApiClient,
) {
    private var cached: HistoryData? = null
    private var cachedKey: String? = null

    /** The closes as JSON for the engine, or null when the scope has nothing traded. */
    suspend fun load(force: Boolean = false): HistoryData? {
        val batches = ApiJson.decodeFromJsonElement(TrackBatches.serializer(), ledger.view("track.batches"))
        if (batches.empty) return null
        val key = batches.batches.joinToString("|") { it.joinToString(",") }
        if (force || key != cachedKey) {
            cached = fetch(batches.batches)
            cachedKey = key
        }
        return cached
    }

    /** One request per batch of tickers; keeps only each company's daily closes. */
    private suspend fun fetch(batches: List<List<String>>): HistoryData {
        val merged = mutableMapOf<String, JsonElement>()
        for (batch in batches) {
            val reply = api.get("/api/price-history?tickers=${URLEncoder.encode(batch.joinToString(","), "UTF-8")}", JsonObject.serializer())
            val all = reply["histories"] as? JsonObject ?: continue
            for ((ticker, history) in all) {
                val eod = (history as? JsonObject)?.get("eod") as? JsonArray
                if (eod != null) merged[ticker] = eod
            }
        }
        val full = buildJsonObject { merged.forEach { (ticker, eod) -> put(ticker, eod) } }.toString()
        val recent = buildJsonObject { merged.forEach { (ticker, eod) -> put(ticker, latest(eod as JsonArray)) } }.toString()
        return HistoryData(full, recent)
    }

    /** The newest few rows of one company's closes (each row is time then close), whichever order the server sent them in. */
    private fun latest(rows: JsonArray): JsonArray =
        JsonArray(rows.sortedByDescending { ((it as? JsonArray)?.firstOrNull() as? JsonPrimitive)?.doubleOrNull ?: 0.0 }.take(RECENT_ROWS))
}

private const val RECENT_ROWS = 5
