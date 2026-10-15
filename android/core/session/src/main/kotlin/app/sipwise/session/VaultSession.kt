package app.sipwise.session

import app.sipwise.network.ApiRequestException
import app.sipwise.vault.PasswordWrapper
import app.sipwise.vault.RecoveryWrapper
import app.sipwise.vault.VaultCrypto
import app.sipwise.vault.VaultErrorCode
import app.sipwise.vault.VaultException
import app.sipwise.vault.VaultKeyMaterial
import app.sipwise.vault.decodeRecoverySecret
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val HTTP_CONFLICT = 409
private const val CODE_NO_VAULT = "no-vault"
private const val INITIAL_WRAPPER_VERSION = 1

class VaultLockedException : Exception("The vault was locked. Unlock it to continue.")

/** A save lost the race with another device. Reload before changing anything. */
class ConflictException(message: String = "Your portfolio changed on another device. Reload before saving.") : Exception(message)

fun isOffline(error: Throwable) = error is ApiRequestException && error.status == 0

/**
 * The shape rules of the decrypted account live in the shared TypeScript (`lib/portfolio-account.ts`) and run in the
 * JavaScript engine. The vault only moves opaque JSON text, and asks these rules before it stores anything.
 */
interface AccountRules {
    /** The empty account a new vault starts with. */
    suspend fun blank(): String

    /** Validates and normalises decrypted text. Throws [IllegalArgumentException] with a readable message. */
    suspend fun normalize(accountJson: String): String

    /** Rejects a change that would edit a locked portfolio. */
    suspend fun assertWritable(
        currentJson: String,
        nextJson: String,
    )
}

sealed interface VaultStatus {
    data object None : VaultStatus

    data class Locked(
        val vault: VaultKeyMaterial,
        val portfolio: EncryptedPortfolioResponse?,
        val offline: Boolean,
    ) : VaultStatus
}

/** Reads the vault metadata and ciphertext needed to unlock; falls back to the device cache when offline. */
suspend fun loadVaultStatus(
    transport: VaultTransport,
    cache: VaultCache = NoCache,
): VaultStatus =
    try {
        fetchStatus(transport, cache)
    } catch (e: ApiRequestException) {
        if (!isOffline(e)) throw e
        val cached = cache.read() ?: throw e
        VaultStatus.Locked(cached.vault, cached.portfolio, offline = true)
    }

private suspend fun fetchStatus(
    transport: VaultTransport,
    cache: VaultCache,
): VaultStatus {
    val vault = transport.getVault().vault
    if (vault == null) {
        cache.clear()
        return VaultStatus.None
    }
    val portfolio = fetchPortfolioOrNull(transport)
    cache.write(CachedVault(vault, portfolio))
    return VaultStatus.Locked(vault, portfolio, offline = false)
}

private suspend fun fetchPortfolioOrNull(transport: VaultTransport): EncryptedPortfolioResponse? =
    try {
        transport.getPortfolio()
    } catch (e: ApiRequestException) {
        if (e.code != CODE_NO_VAULT) throw e
        null
    }

class PreparedVault internal constructor(
    /** Show once, make the person confirm they saved it, and never persist it. */
    val recoverySecret: String,
    private val finishWith: suspend () -> VaultSession,
    private val discardWith: () -> Unit,
) {
    /** Nothing has been sent to the server before this call. */
    suspend fun finish(): VaultSession = finishWith()

    fun discard() = discardWith()
}

/** Generates a vault locally. Nothing is uploaded until [PreparedVault.finish], after the recovery key was confirmed. */
suspend fun prepareVault(
    transport: VaultTransport,
    rules: AccountRules,
    password: String,
    cache: VaultCache = NoCache,
    crypto: VaultCrypto = VaultCrypto(),
): PreparedVault {
    val keys = withContext(Dispatchers.Default) { crypto.createVaultKeys(password) }
    val material = keys.material.copy(wrapperVersion = INITIAL_WRAPPER_VERSION)
    val blank = rules.blank()
    val envelope = crypto.encryptPortfolio(keys.dataKey, material.vaultId, material.keyVersion, 1, blank)
    var done = false
    return PreparedVault(
        recoverySecret = keys.recoverySecret,
        finishWith = {
            check(!done) { "This vault was already created." }
            done = true
            val created =
                try {
                    transport.postVault(VaultSetupRequest(material, envelope))
                } catch (e: ApiRequestException) {
                    keys.dataKey.fill(0)
                    throw e
                }
            val stored = EncryptedPortfolioResponse(material.vaultId, 1, envelope, created.vault.createdAt.orEmpty())
            cache.write(CachedVault(created.vault, stored))
            VaultSession(transport, cache, rules, crypto, created.vault, keys.dataKey, 1, blank, offline = false)
        },
        discardWith = {
            done = true
            keys.dataKey.fill(0)
        },
    )
}

/** Opens a vault with the password or the recovery key. Authentication alone never opens one. */
suspend fun unlockVault(
    transport: VaultTransport,
    rules: AccountRules,
    status: VaultStatus.Locked,
    secret: UnlockSecret,
    cache: VaultCache = NoCache,
    crypto: VaultCrypto = VaultCrypto(),
): VaultSession {
    val key =
        withContext(Dispatchers.Default) {
            when (secret) {
                is UnlockSecret.Password -> crypto.unwrapWithPassword(status.vault, secret.value)
                is UnlockSecret.Recovery -> crypto.unwrapWithRecovery(status.vault, secret.value)
            }
        }
    return openWithKey(transport, rules, status, key, cache, crypto)
}

sealed interface UnlockSecret {
    data class Password(val value: String) : UnlockSecret

    data class Recovery(val value: String) : UnlockSecret
}

/** Opens with an already unwrapped data key (fingerprint unlock). Takes ownership: zeroed if decryption fails. */
suspend fun openWithKey(
    transport: VaultTransport,
    rules: AccountRules,
    status: VaultStatus.Locked,
    dataKey: ByteArray,
    cache: VaultCache = NoCache,
    crypto: VaultCrypto = VaultCrypto(),
): VaultSession {
    try {
        val stored =
            status.portfolio
                ?: throw VaultException(VaultErrorCode.INVALID, "No encrypted portfolio was found for this vault.")
        val plain = crypto.decryptPortfolio(dataKey, stored.envelope, status.vault.vaultId, status.vault.keyVersion, stored.revision)
        val account = parseAccount(rules, plain)
        return VaultSession(transport, cache, rules, crypto, status.vault, dataKey, stored.revision, account, status.offline)
    } catch (e: VaultException) {
        dataKey.fill(0)
        throw e
    }
}

private suspend fun parseAccount(
    rules: AccountRules,
    text: String,
): String =
    try {
        rules.normalize(text)
    } catch (e: IllegalArgumentException) {
        throw VaultException(VaultErrorCode.INVALID, e.message ?: "The decrypted portfolio is not readable.", e)
    }

/**
 * Forgotten password: open with the recovery key, then replace the password wrapper. The recovery key keeps working
 * afterwards (replacing it is a separate, confirmed step).
 */
suspend fun recoverWithKey(
    transport: VaultTransport,
    rules: AccountRules,
    status: VaultStatus.Locked,
    recoverySecret: String,
    newPassword: String,
    cache: VaultCache = NoCache,
    crypto: VaultCrypto = VaultCrypto(),
): VaultSession {
    decodeRecoverySecret(recoverySecret).fill(0)
    if (status.offline) throw ApiRequestException("Reconnect to the internet to reset your password.", 0)
    val session = unlockVault(transport, rules, status, UnlockSecret.Recovery(recoverySecret), cache, crypto)
    try {
        session.replacePasswordAfterRecovery(newPassword)
        return session
    } catch (e: ApiRequestException) {
        session.lock()
        throw e
    } catch (e: VaultException) {
        session.lock()
        throw e
    }
}

class RecoveryDraft internal constructor(val recoverySecret: String, internal val wrapper: RecoveryWrapper)

/**
 * The unlocked vault. Keys live only in this object: [lock] zeroes the data key and invalidates every in-flight call,
 * so a request that finishes after a lock fails with [VaultLockedException] instead of returning data or writing.
 * A save encrypts for revision+1 and the server applies it only if the revision is still current (409 otherwise).
 */
@Suppress("LongParameterList")
class VaultSession internal constructor(
    private val transport: VaultTransport,
    private val cache: VaultCache,
    private val rules: AccountRules,
    private val crypto: VaultCrypto,
    private var material: VaultKeyMaterial,
    dataKey: ByteArray,
    revision: Int,
    account: String,
    offline: Boolean,
) {
    @Volatile private var key: ByteArray? = dataKey

    @Volatile private var epoch = 0
    private val lockListeners = mutableSetOf<() -> Unit>()

    /** True while the session was opened from the device cache because the server was unreachable. */
    @Volatile var offline: Boolean = offline
        private set

    @Volatile var revision: Int = revision
        private set

    /** The decrypted account as JSON text. */
    @Volatile var account: String = account
        private set

    val vaultId: String get() = material.vaultId
    val wrapperVersion: Int get() = material.wrapperVersion
    val active: Boolean get() = key != null

    @Synchronized
    fun onLock(listener: () -> Unit): () -> Unit {
        lockListeners += listener
        return { synchronized(this) { lockListeners -= listener } }
    }

    /** Zeroes the key, drops decrypted state and invalidates in-flight calls. */
    fun lock() {
        val listeners: List<() -> Unit>
        synchronized(this) {
            val current = key ?: return
            current.fill(0)
            key = null
            epoch++
            account = ""
            revision = 0
            listeners = lockListeners.toList()
            lockListeners.clear()
        }
        listeners.forEach { it() }
    }

    /** A copy of the data key for the fingerprint wrapper. The caller must zero it. */
    fun exportKey(): ByteArray = requireKey().copyOf()

    private fun requireKey(): ByteArray = key ?: throw VaultLockedException()

    private fun assertCurrent(at: Int) {
        if (epoch != at || key == null) throw VaultLockedException()
    }

    private suspend fun <T> guarded(work: suspend () -> T): T {
        requireKey()
        val at = epoch
        val result =
            try {
                work()
            } catch (e: VaultLockedException) {
                throw e
            } catch (e: Exception) {
                // Work cut off by a lock fails in odd ways (the key was zeroed under it): report the lock.
                if (epoch != at || key == null) throw VaultLockedException()
                throw e
            }
        assertCurrent(at)
        return result
    }

    /** Re-reads and decrypts the stored portfolio. Never merges with local state. */
    suspend fun reload(): String =
        guarded {
            val dataKey = requireKey()
            val at = epoch
            val stored =
                try {
                    transport.getPortfolio()
                } catch (e: ApiRequestException) {
                    if (!isOffline(e)) throw e
                    offline = true
                    return@guarded account
                }
            val plain = crypto.decryptPortfolio(dataKey, stored.envelope, material.vaultId, material.keyVersion, stored.revision)
            val parsed = parseAccount(rules, plain)
            assertCurrent(at)
            offline = false
            if (stored.revision < revision) return@guarded account
            account = parsed
            revision = stored.revision
            cache.write(CachedVault(material, stored))
            parsed
        }

    /**
     * Encrypts [next] for `expectedRevision + 1` and stores it only if the server still has `expectedRevision`.
     * Throws [ConflictException] on a lost race (nothing is written), [VaultLockedException] if locked meanwhile.
     * [replaceAll] is an explicit, confirmed "replace everything" (restore, delete all data).
     */
    suspend fun save(
        next: String,
        expectedRevision: Int,
        replaceAll: Boolean = false,
    ): Int =
        guarded {
            if (expectedRevision != revision) throw ConflictException()
            val normalized = parseAccount(rules, next)
            if (!replaceAll) rules.assertWritable(account, normalized)
            val dataKey = requireKey()
            val at = epoch
            val envelope = crypto.encryptPortfolio(dataKey, material.vaultId, material.keyVersion, expectedRevision + 1, next)
            try {
                val saved = transport.putPortfolio(SaveEncryptedPortfolioRequest(envelope, expectedRevision))
                assertCurrent(at)
                account = normalized
                revision = saved.revision
                val stored = EncryptedPortfolioResponse(material.vaultId, saved.revision, envelope, "")
                cache.write(CachedVault(material, stored))
                saved.revision
            } catch (e: ApiRequestException) {
                if (e.status == HTTP_CONFLICT) throw ConflictException()
                throw e
            }
        }

    private suspend fun putWrappers(
        password: PasswordWrapper? = null,
        recovery: RecoveryWrapper? = null,
    ) {
        val at = epoch
        val response = transport.putWrappers(VaultWrappersRequest(material.wrapperVersion, password, recovery))
        assertCurrent(at)
        material =
            material.copy(
                wrapperVersion = response.wrapperVersion,
                password = password ?: material.password,
                recovery = recovery ?: material.recovery,
            )
        cache.write(CachedVault(material, cache.read()?.portfolio))
    }

    /** Ordinary password change: rewraps the SAME data key with a fresh salt and nonce. */
    suspend fun changePassword(
        currentPassword: String,
        newPassword: String,
    ) = guarded {
        // Re-verify the current password so a borrowed unlocked session cannot silently change it.
        withContext(Dispatchers.Default) { crypto.unwrapWithPassword(material, currentPassword).fill(0) }
        putWrappers(password = rewrap(newPassword))
    }

    /** Replaces the password wrapper after a recovery-key unlock (the current password is unknown). */
    suspend fun replacePasswordAfterRecovery(newPassword: String) =
        guarded {
            putWrappers(password = rewrap(newPassword))
        }

    private suspend fun rewrap(newPassword: String): PasswordWrapper =
        withContext(Dispatchers.Default) { crypto.wrapWithPassword(requireKey(), material.vaultId, material.keyVersion, newPassword) }

    /** The encrypted backup: wrapped keys plus stored ciphertext, readable without the server. */
    suspend fun backupPackage(): BackupPackage =
        guarded {
            val stored =
                try {
                    transport.getPortfolio()
                } catch (e: ApiRequestException) {
                    if (!isOffline(e)) throw e
                    cache.read()?.portfolio
                }
            val portfolio = stored ?: throw VaultException(VaultErrorCode.INVALID, "No encrypted portfolio is available to back up yet.")
            createBackupPackage(material, portfolio.revision, portfolio.envelope)
        }

    /** Step 1 of replacing the recovery key: generate it locally. Nothing changes until [commitRecovery]. */
    suspend fun prepareRecovery(): RecoveryDraft =
        guarded {
            val (wrapper, secret) = crypto.wrapWithRecovery(requireKey(), material.vaultId, material.keyVersion)
            RecoveryDraft(secret, wrapper)
        }

    /** Step 2, after the person confirmed they saved the new recovery key. */
    suspend fun commitRecovery(draft: RecoveryDraft) = guarded { putWrappers(recovery = draft.wrapper) }
}
