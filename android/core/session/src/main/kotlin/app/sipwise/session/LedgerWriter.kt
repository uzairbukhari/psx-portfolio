package app.sipwise.session

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The part of a vault session the ledger needs: the current account and a revisioned save. */
interface AccountStore {
    val account: String
    val revision: Int

    suspend fun save(
        next: String,
        expectedRevision: Int,
        replaceAll: Boolean = false,
    ): Int
}

fun VaultSession.asStore(): AccountStore =
    object : AccountStore {
        override val account: String get() = this@asStore.account
        override val revision: Int get() = this@asStore.revision

        override suspend fun save(
            next: String,
            expectedRevision: Int,
            replaceAll: Boolean,
        ): Int = this@asStore.save(next, expectedRevision, replaceAll)
    }

/** What a successful change leaves behind, so the screen can offer Undo. */
data class SavedChange(val revision: Int, val previousAccount: String, val replaceAll: Boolean = false)

/**
 * Every ledger change goes through here: the shared TypeScript validates and builds the next account, the vault saves
 * it (encrypted, revision-checked), and only then is it loaded back into the engine. A failed or conflicting save
 * therefore never changes what the screens show.
 */
class LedgerWriter(private val store: AccountStore, private val engine: EngineClient) {
    suspend fun apply(
        portfolioId: String,
        op: String,
        params: JsonObject,
    ): SavedChange {
        val reply = engine.call("mutate", mapOf("portfolio" to portfolioId, "op" to op, "params" to params.toString()))
        val next = reply.jsonObject["account"]?.jsonPrimitive?.content ?: error("The engine returned no account.")
        return commit(next)
    }

    /**
     * A change to the account as a whole (the tax status), written into every portfolio, locked ones too: it is a
     * setting, not a ledger record, so it is saved as an explicit replace.
     */
    suspend fun applyAccount(
        op: String,
        params: JsonObject,
    ): SavedChange {
        val reply = engine.call("mutate.account", mapOf("op" to op, "params" to params.toString()))
        val next = reply.jsonObject["account"]?.jsonPrimitive?.content ?: error("The engine returned no account.")
        return commit(next, replaceAll = true)
    }

    /** Puts the account back as it was before [change], failing with a conflict if something else saved in between. */
    suspend fun undo(change: SavedChange): SavedChange =
        commit(change.previousAccount, expectedRevision = change.revision, replaceAll = change.replaceAll)

    private suspend fun commit(
        next: String,
        expectedRevision: Int = store.revision,
        replaceAll: Boolean = false,
    ): SavedChange {
        val previous = store.account
        val revision = store.save(next, expectedRevision, replaceAll)
        engine.call("account.load", mapOf("json" to next))
        return SavedChange(revision, previous, replaceAll)
    }
}
