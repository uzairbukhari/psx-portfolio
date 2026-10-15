package app.sipwise.auth

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.BuildConfig
import app.sipwise.SipwiseApp
import app.sipwise.data.FileVaultCache
import app.sipwise.network.ApiRequestException
import app.sipwise.network.MeResponse
import app.sipwise.network.MobileSignInRequest
import app.sipwise.network.MobileSignInResponse
import app.sipwise.session.LocalCleanup
import app.sipwise.session.SignOutResult
import app.sipwise.session.clearLocalState
import app.sipwise.session.retryPendingSignOut
import app.sipwise.session.signOutRemote
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface AuthState {
    data object Loading : AuthState

    data object SignedOut : AuthState

    data class SignedIn(val user: MeResponse) : AuthState
}

/** Google sign-in, the session token, and every way out of an account. Mirrors AuthProvider.tsx in the Expo app. */
class AuthViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as SipwiseApp).container
    private val sessions = container.sessions
    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    private val _signOutPending = MutableStateFlow(false)
    val signOutPending: StateFlow<Boolean> = _signOutPending.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        container.onUnauthorized = { viewModelScope.launch { clearLocal() } }
        viewModelScope.launch {
            _signOutPending.value =
                retryPendingSignOut(
                    read = { sessions.pendingSignOut() },
                    revoke = { container.revokeSession(it) },
                    clear = { sessions.clearPendingSignOut() },
                )
            start()
        }
    }

    private suspend fun start() {
        if (sessions.token() == null) {
            _state.value = AuthState.SignedOut
            return
        }
        try {
            val user = container.api.get("/api/me", MeResponse.serializer())
            sessions.saveProfile(user)
            _state.value = AuthState.SignedIn(user)
        } catch (e: ApiRequestException) {
            // A rejected token signs out through onUnauthorized. Offline at launch keeps the saved profile so the
            // cached portfolio still opens.
            if (e.status == HTTP_UNAUTHORIZED) return
            val saved = sessions.profile()
            _state.value = if (saved != null) AuthState.SignedIn(saved) else AuthState.SignedOut
        }
    }

    fun signIn(activityContext: Context) {
        viewModelScope.launch {
            _message.value = null
            try {
                val idToken = container.google.idToken(activityContext)
                val body = MobileSignInRequest(idToken, deviceName = Build.MODEL, platform = "android")
                val result =
                    container.api.post(
                        "/api/auth/mobile/google",
                        body,
                        MobileSignInRequest.serializer(),
                        MobileSignInResponse.serializer(),
                        authed = false,
                    )
                sessions.saveToken(result.token)
                sessions.saveProfile(result.user)
                _state.value = AuthState.SignedIn(result.user)
            } catch (ignored: SignInCancelledException) {
                _message.value = null
            } catch (e: SignInFailedException) {
                // Staging builds say why Google refused, so a setup mistake is visible without a debugger.
                val cause = e.cause
                _message.value =
                    if (BuildConfig.SIGN_IN_DETAIL && cause != null) {
                        "${e.message} (${cause.javaClass.simpleName}: ${cause.message})"
                    } else {
                        e.message
                    }
            } catch (e: ApiRequestException) {
                _message.value = e.message
            }
        }
    }

    /** User-initiated: also ends the server-side session. Offline, the revoke is queued and retried next launch. */
    fun signOut() {
        viewModelScope.launch {
            val result =
                signOutRemote(
                    token = sessions.token(),
                    revoke = { container.revokeSession(it) },
                    queue = { sessions.queueSignOut(it) },
                )
            if (result == SignOutResult.QUEUED) _signOutPending.value = true
            clearLocal()
        }
    }

    /** The server has deleted the account; this only clears what the phone still holds. */
    fun accountDeleted() {
        viewModelScope.launch { clearLocal() }
    }

    fun dismissMessage() {
        _message.value = null
    }

    /** Local cleanup only, run on every way out. It never calls the server. */
    private suspend fun clearLocal() {
        val email = (state.value as? AuthState.SignedIn)?.user?.email ?: sessions.profile()?.email
        val app = getApplication<Application>()
        clearLocalState(
            LocalCleanup(
                email = email,
                clearToken = { sessions.clearToken() },
                clearProfile = { sessions.clearProfile() },
                googleSignOut = { container.google.signOut() },
                clearQueries = { },
                clearPortfolioCache = { FileVaultCache.forContext(app, it).clear() },
                clearPushPreference = {
                    container.preferences.setPushEnabled(false)
                    email?.let { container.biometric.forget(it) }
                },
            ),
        )
        FileVaultCache.purgeLegacy(app)
        _state.value = AuthState.SignedOut
    }

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
    }
}
