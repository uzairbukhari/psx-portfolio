package app.sipwise

import android.app.Application
import app.sipwise.auth.GoogleSignIn
import app.sipwise.data.Preferences
import app.sipwise.data.SecureStorage
import app.sipwise.data.SessionStore
import app.sipwise.network.ApiClient
import app.sipwise.network.ApiRequestException
import app.sipwise.network.TokenSource
import app.sipwise.push.PushRegistrar
import app.sipwise.push.ensureNotificationChannel
import app.sipwise.session.ApiVaultTransport
import app.sipwise.session.VaultTransport
import kotlinx.serialization.json.JsonElement

/** Hand-wired dependencies: small enough that a DI framework would only add build time. */
class AppContainer(private val app: Application) {
    val sessions = SessionStore(SecureStorage(app))
    val google = GoogleSignIn(app)
    val preferences = Preferences(app)

    /** Set by the auth screen model: called when the server rejects the token. */
    @Volatile var onUnauthorized: () -> Unit = {}

    val api =
        ApiClient(
            baseUrl = BuildConfig.API_BASE_URL,
            tokens = TokenSource { sessions.token() },
            onUnauthorized = { onUnauthorized() },
        )
    val vaultTransport: VaultTransport = ApiVaultTransport(api)
    val push = PushRegistrar(app, api)

    /** Ends one server session using [token] rather than the stored one (sign-out of a queued token). */
    suspend fun revokeSession(token: String) {
        ApiClient(BuildConfig.API_BASE_URL, TokenSource { token })
            .delete("/api/mobile-sessions?id=current", JsonElement.serializer())
    }
}

class SipwiseApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        ensureNotificationChannel(this)
    }
}
