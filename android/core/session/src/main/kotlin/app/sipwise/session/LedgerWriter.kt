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
    ): Int
}

fun VaultSession.asStore(): AccountStore =
    object : AccountStore {
        override val account: String get() = this@asStore.account
        override val revision: Int get() = this@asStore.revision

        override suspend fun save(
            next: String,
            expectedRevision: Int,
        ): Int = this@asStore.save(next, expectedRevision)
    }

/** What a successful change leaves behind, so the screen can offer Undo. */
data class SavedChange(val revision: Int, val previousAccount: String)

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

    /** Puts the account back as it was before [change], failing with a conflict if something else saved in between. */
    suspend fun undo(change: SavedChange): SavedChange = commit(change.previousAccount, expectedRevision = change.revision)

    private suspend fun commit(
        next: String,
        expectedRevision: Int = store.revision,
    ): SavedChange {
        val previous = store.account
        val revision = store.save(next, expectedRevision)
        engine.call("account.load", mapOf("json" to next))
        return SavedChange(revision, previous)
    }
}
