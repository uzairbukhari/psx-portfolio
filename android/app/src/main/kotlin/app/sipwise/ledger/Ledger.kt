package app.sipwise.ledger

import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.DividendSync
import app.sipwise.model.EntryKind
import app.sipwise.model.MarketSummaryResponse
import app.sipwise.model.PublicWanted
import app.sipwise.model.RatesWanted
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.network.QuoteJob
import app.sipwise.network.QuoteTickers
import app.sipwise.network.QuotesJobResponse
import app.sipwise.network.QuotesResponse
import app.sipwise.network.followQuoteJob
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineClient
import app.sipwise.session.EngineException
import app.sipwise.session.LedgerWriter
import app.sipwise.session.SavedChange
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLEncoder
import java.time.LocalDate

/** What kind of change was saved, so the notice can say it in words. */
enum class LedgerAction { ENTRY, PRICE, RECEIVED, VOID, BUYS, BUDGET, TARGETS, CORRECTION, TAX, PORTFOLIOS, PICKS }

/** Something the person just recorded, so the shell can say so and offer Undo. */
data class LedgerNotice(val kind: EntryKind?, val ticker: String, val change: SavedChange, val action: LedgerAction = LedgerAction.ENTRY)

/**
 * The unlocked account as the screens see it: the calculation engine to read from, and one place to write through.
 * [version] changes after every committed change or undo, which is the screens' cue to read again.
 */
class Ledger(
    val engine: EngineClient,
    private val writer: LedgerWriter,
    private val api: ApiClient? = null,
) {
    private var lastPublicRefresh = 0L
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
        notify: Boolean = true,
    ) {
        val change = writer.apply(portfolioId, op, params)
        _version.value += 1
        if (notify) _notices.tryEmit(LedgerNotice(kind, ticker, change, action))
    }

    /** A change to the account as a whole, such as the tax status. */
    suspend fun applyAccount(
        op: String,
        params: JsonObject,
        label: String = "",
        action: LedgerAction = LedgerAction.TAX,
        notify: Boolean = true,
    ) {
        val change = writer.applyAccount(op, params)
        _version.value += 1
        if (notify) _notices.tryEmit(LedgerNotice(null, label, change, action))
    }

    /** The public KSE-100 snapshot, or null while offline. No holdings are involved. */
    suspend fun marketSummary(): MarketSummaryResponse? {
        val client = api ?: return null
        return try {
            client.get("/api/market-summary", MarketSummaryResponse.serializer())
        } catch (ignored: ApiRequestException) {
            null
        }
    }

    /** Confirms [ticker] is a current PSX symbol and returns its quote as the server sent it. Only the symbol leaves the phone. */
    suspend fun confirmCompany(ticker: String): JsonElement {
        val client = api ?: throw CompanyNotConfirmedException("$ticker could not be confirmed on PSX: you are offline.")
        val reply =
            try {
                client.post("/api/quotes", QuoteTickers(listOf(ticker)), QuoteTickers.serializer(), QuotesResponse.serializer())
            } catch (e: ApiRequestException) {
                throw CompanyNotConfirmedException("$ticker could not be confirmed on PSX: ${e.message ?: "try again"}", e)
            }
        return reply.quotes[ticker] ?: throw CompanyNotConfirmedException("$ticker is not available as a current PSX symbol.")
    }

    /** Whether the PSX is open right now, by the shared market calendar. */
    suspend fun marketOpen(): Boolean = (engine.call("market.open") as? JsonObject)?.get("open")?.jsonPrimitive?.booleanOrNull ?: false

    /**
     * The manual "Refresh prices": asks the server to fetch fresh PSX prices for what this ledger holds or targets, follows
     * the job until it settles, then reloads the shared prices. Returns the settled job (its message is the server's wording).
     */
    suspend fun refreshPrices(onPending: (QuoteJob) -> Unit = {}): QuoteJob? {
        val client = api ?: return null
        val tickers = ApiJson.decodeFromJsonElement(QuoteTickers.serializer(), engine.call("prices.tickers")).tickers
        if (tickers.isEmpty()) return null
        val list = encode(tickers)
        val job =
            followQuoteJob(
                start = { client.post("/api/quotes", QuoteTickers(tickers), QuoteTickers.serializer(), QuotesJobResponse.serializer()).job },
                poll = { since -> client.get("/api/quotes?tickers=$list&since=${URLEncoder.encode(since.orEmpty(), "UTF-8")}", QuotesJobResponse.serializer()).job },
                onPending = onPending,
            )
        refreshPublic(force = true)
        return job
    }

    /**
     * Lays the shared public data (prices, payout announcements, company names) over the ledger for display, then
     * adds any automatic dividends. Best effort: offline or a server hiccup leaves the ledger as it was. Only ticker
     * symbols are sent. Throttled so returning to the app does not refetch every time.
     */
    suspend fun refreshPublic(
        now: Long = System.currentTimeMillis(),
        force: Boolean = false,
    ) {
        val client = api ?: return
        if (!force && now - lastPublicRefresh < PUBLIC_REFRESH_MS) return
        lastPublicRefresh = now
        try {
            val wanted = ApiJson.decodeFromJsonElement(PublicWanted.serializer(), engine.call("public.wanted"))
            if (wanted.tickers.isNotEmpty()) loadPrices(client, wanted.tickers)
            if (wanted.placeholders.isNotEmpty()) loadLookups(client, wanted.placeholders)
            loadRates(client)
            _version.value += 1
            syncDividends()
        } catch (ignored: ApiRequestException) {
            // Public data is optional; the ledger still shows what it has saved.
        } catch (ignored: EngineException) {
            // The engine can be gone after a long time in the background; the vault locks itself and asks again.
        }
    }

    private suspend fun loadPrices(
        client: ApiClient,
        tickers: List<String>,
    ) {
        engine.call("public.reset")
        for (part in tickers.chunked(MARKET_CHUNK)) {
            val reply = client.get("/api/public-data?tickers=${encode(part)}", JsonElement.serializer())
            engine.call("public.add", mapOf("json" to reply.toString()))
        }
    }

    private suspend fun loadLookups(
        client: ApiClient,
        tickers: List<String>,
    ) {
        val found = mutableListOf<JsonElement>()
        for (part in tickers.chunked(LOOKUP_CHUNK)) {
            val reply = client.get("/api/companies?tickers=${encode(part)}", JsonObject.serializer())
            (reply["companies"] as? JsonArray)?.let { found.addAll(it) }
        }
        engine.call("public.lookups", mapOf("json" to JsonArray(found).toString()))
    }

    /** Public gold, silver and currency rates and fund prices, only for the kinds this ledger holds. They carry no parameters. */
    private suspend fun loadRates(client: ApiClient) {
        val wanted = ApiJson.decodeFromJsonElement(RatesWanted.serializer(), engine.call("rates.wanted"))
        if (!wanted.any) return
        val args = mutableMapOf<String, String>()
        if (wanted.metals) {
            val reply = client.get("/api/public-data/metals", JsonObject.serializer())
            args["metals"] = (reply["rates"] ?: JsonArray(emptyList())).toString()
        }
        if (wanted.funds) {
            val reply = client.get("/api/public-data/funds", JsonObject.serializer())
            val latest = (reply["funds"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("latest") }.filter { it !is JsonNull }
            args["navs"] = JsonArray(latest + recentFundNavs(client, wanted.fundIds)).toString()
        }
        if (wanted.plans) {
            val reply = client.get("/api/public-data/plan-navs", JsonObject.serializer())
            args["plans"] = (reply["navs"] ?: JsonArray(emptyList())).toString()
        }
        if (wanted.fx) {
            val reply = client.get("/api/public-data/fx", JsonObject.serializer())
            args["fx"] = (reply["rates"] ?: JsonArray(emptyList())).toString()
        }
        engine.call("rates.set", args)
    }

    /**
     * The last couple of weeks of prices for the funds held, so Today can say how they moved over three days. A fund
     * whose history cannot be read keeps only its newest price and simply has no move.
     */
    private suspend fun recentFundNavs(
        client: ApiClient,
        ids: List<String>,
    ): List<JsonElement> {
        val from = LocalDate.now().minusDays(FUND_HISTORY_DAYS).toString()
        return ids.flatMap { id ->
            try {
                val reply = client.get("/api/public-data/funds?fund=${encode(listOf(id))}", JsonObject.serializer())
                (reply["navs"] as? JsonArray).orEmpty().filter { ((it as? JsonObject)?.get("date") as? JsonPrimitive)?.content.orEmpty() >= from }
            } catch (ignored: ApiRequestException) {
                emptyList()
            }
        }
    }

    private suspend fun syncDividends() {
        val sync = ApiJson.decodeFromJsonElement(DividendSync.serializer(), engine.call("dividends.sync"))
        val next = sync.account ?: return
        if (!sync.changed) return
        try {
            writer.saveNext(next)
            _version.value += 1
        } catch (ignored: ConflictException) {
            // Another device saved first; the next refresh plans again from the newer ledger.
        }
    }

    private fun encode(tickers: List<String>) = URLEncoder.encode(tickers.joinToString(","), Charsets.UTF_8.name())

    suspend fun undo(change: SavedChange) {
        writer.undo(change)
        _version.value += 1
    }
}

private const val PUBLIC_REFRESH_MS = 60_000L
private const val MARKET_CHUNK = 100
private const val LOOKUP_CHUNK = 50
private const val FUND_HISTORY_DAYS = 14L

class CompanyNotConfirmedException(message: String, cause: Throwable? = null) : Exception(message, cause)
