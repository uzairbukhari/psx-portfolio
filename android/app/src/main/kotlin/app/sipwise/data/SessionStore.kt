package app.sipwise.data

import app.sipwise.network.ApiJson
import app.sipwise.network.MeResponse

private const val TOKEN = "token"
private const val PENDING_SIGN_OUT = "pendingSignOut"
private const val ME = "me"

/** The signed-in session: token, profile and a sign-out the server has not confirmed yet. */
class SessionStore(private val storage: SecureStorage) {
    fun token(): String? = storage.get(TOKEN)

    fun saveToken(token: String) = storage.put(TOKEN, token)

    fun clearToken() = storage.remove(TOKEN)

    fun pendingSignOut(): String? = storage.get(PENDING_SIGN_OUT)

    fun queueSignOut(token: String) = storage.put(PENDING_SIGN_OUT, token)

    fun clearPendingSignOut() = storage.remove(PENDING_SIGN_OUT)

    fun saveProfile(me: MeResponse) = storage.put(ME, ApiJson.encodeToString(MeResponse.serializer(), me))

    fun profile(): MeResponse? =
        storage.get(ME)?.let { runCatching { ApiJson.decodeFromString(MeResponse.serializer(), it) }.getOrNull() }

    fun clearProfile() = storage.remove(ME)
}
