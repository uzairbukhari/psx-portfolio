package app.sipwise.session

import app.sipwise.network.ApiRequestException
import java.security.MessageDigest
import java.util.Locale

private const val SERVER_ERROR_FROM = 500
private const val CACHE_HASH_CHARS = 16

/** What leaving an account must erase from the phone. Side effects are injected so this stays unit-testable. */
class LocalCleanup(
    /** Email of the account being signed out, used to find its cached portfolio. */
    val email: String?,
    val clearToken: suspend () -> Unit,
    val clearProfile: suspend () -> Unit,
    val googleSignOut: suspend () -> Unit,
    val clearQueries: suspend () -> Unit,
    val clearPortfolioCache: suspend (String) -> Unit,
    val clearPushPreference: suspend () -> Unit,
)

/** Every step runs even if another fails, so one broken store cannot leave data behind. */
suspend fun clearLocalState(cleanup: LocalCleanup) {
    val steps: List<suspend () -> Unit> =
        listOf(
            cleanup.clearToken,
            cleanup.clearProfile,
            cleanup.googleSignOut,
            cleanup.clearQueries,
            { cleanup.email?.let { cleanup.clearPortfolioCache(it) } },
            cleanup.clearPushPreference,
        )
    for (step in steps) {
        try {
            step()
        } catch (ignored: Exception) {
            // keep going
            ignored.message
        }
    }
}

/** 401/404: the server session is already gone. Anything else the server answered will not improve on retry. */
private fun retryable(error: Throwable): Boolean {
    val status = (error as? ApiRequestException)?.status ?: 0
    return status == 0 || status >= SERVER_ERROR_FROM
}

enum class SignOutResult { REVOKED, QUEUED, NONE }

/**
 * Ends the server session for [token]. If the server cannot be reached the token is queued so the revoke is retried on
 * the next launch (the session otherwise stays live for up to 90 days).
 */
suspend fun signOutRemote(
    token: String?,
    revoke: suspend (String) -> Unit,
    queue: suspend (String) -> Unit,
): SignOutResult {
    if (token == null) return SignOutResult.NONE
    return try {
        revoke(token)
        SignOutResult.REVOKED
    } catch (e: ApiRequestException) {
        if (!retryable(e)) return SignOutResult.REVOKED
        runCatching { queue(token) }
        SignOutResult.QUEUED
    }
}

/** On launch: finish a queued sign-out. Returns whether one is still pending. */
suspend fun retryPendingSignOut(
    read: suspend () -> String?,
    revoke: suspend (String) -> Unit,
    clear: suspend () -> Unit,
): Boolean {
    val token = runCatching { read() }.getOrNull() ?: return false
    try {
        revoke(token)
    } catch (e: ApiRequestException) {
        if (retryable(e)) return true
    }
    runCatching { clear() }
    return false
}

/** `vault-<16 hex>.json`: opaque, stable per account, never the email. Same name the Expo app used. */
fun vaultCacheName(email: String): String {
    val input = "sipwise-vault-cache/v1|${email.trim().lowercase(Locale.ROOT)}"
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return "vault-${digest.joinToString("") { "%02x".format(it) }.take(CACHE_HASH_CHARS)}.json"
}

/** Cache files written by versions before encryption held the whole readable portfolio. */
fun isLegacyPlaintextCacheName(name: String) = Regex("^portfolio-.*\\.json$").matches(name)

/**
 * How long the app may sit in the background before the vault locks. Longer than the optional biometric grace: the
 * document picker, share sheet and Google flows briefly background the app.
 */
const val VAULT_LOCK_GRACE_MS = 60_000L

fun shouldLockVault(
    backgroundedAt: Long?,
    now: Long,
    graceMs: Long = VAULT_LOCK_GRACE_MS,
) = backgroundedAt != null && now - backgroundedAt >= graceMs

/** The app switcher snapshot is taken as the app leaves the foreground, so the content is covered from that moment. */
fun coversVault(
    unlocked: Boolean,
    appActive: Boolean,
) = unlocked && !appActive
