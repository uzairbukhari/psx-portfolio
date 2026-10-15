package app.sipwise.network

import kotlinx.serialization.Serializable

/** Mirrors lib/api-types.ts. */
@Serializable
data class MeResponse(
    val email: String,
    val name: String? = null,
    val picture: String? = null,
    val role: String = "user",
)

@Serializable
data class MobileSignInRequest(
    val idToken: String,
    val deviceName: String? = null,
    val platform: String? = null,
)

@Serializable
data class MobileSignInResponse(
    val token: String,
    val user: MeResponse,
)

@Serializable
data class DeleteAccountRequest(
    val confirm: String,
)

@Serializable
data class DeleteAccountResponse(
    val deleted: Boolean = true,
)

@Serializable
data class MobileSessionInfo(
    val id: String,
    val deviceName: String,
    val platform: String = "",
    val createdAt: String = "",
    val lastSeenAt: String = "",
)

@Serializable
data class MobileSessionsResponse(val sessions: List<MobileSessionInfo> = emptyList())

@Serializable
data class PushTokenRequest(
    val token: String,
)

@Serializable
data class PushTestResponse(
    val sent: Int = 0,
)

@Serializable
data class FactsRefreshRequest(
    val tickers: List<String>,
    val action: String = "refresh-facts",
)

@Serializable
data class FactsRefreshResponse(
    val waiting: Boolean = false,
)
