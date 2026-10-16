package app.sipwise.vault

import android.app.Application
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewModelScope
import app.sipwise.R
import app.sipwise.SipwiseApp
import app.sipwise.data.BiometricInvalidatedException
import app.sipwise.data.FileVaultCache
import app.sipwise.engine.EngineUnavailableException
import app.sipwise.engine.JsEngineBridge
import app.sipwise.ledger.Ledger
import app.sipwise.network.ApiRequestException
import app.sipwise.network.Events
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineAccountRules
import app.sipwise.session.EngineClient
import app.sipwise.session.EngineFailures
import app.sipwise.session.LedgerWriter
import app.sipwise.session.PreparedVault
import app.sipwise.session.UnlockSecret
import app.sipwise.session.VaultSession
import app.sipwise.session.VaultStatus
import app.sipwise.session.asStore
import app.sipwise.session.loadVaultStatus
import app.sipwise.session.openWithKey
import app.sipwise.session.prepareVault
import app.sipwise.session.recoverWithKey
import app.sipwise.session.shouldLockVault
import app.sipwise.session.unlockVault
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the vault screens show. The decrypted portfolio exists only inside [Unlocked]. */
sealed interface VaultUi {
    data object Checking : VaultUi

    data class Failed(val message: String) : VaultUi

    data object NeedsSetup : VaultUi

    /** The recovery key is on screen and nothing has been uploaded until it is confirmed. */
    data class ConfirmRecovery(val recoveryKey: String) : VaultUi

    data class Locked(val offline: Boolean) : VaultUi

    data class Unlocked(val session: VaultSession, val ledger: Ledger) : VaultUi
}

/** Where an unlock is, so the unlock screen can narrate the few seconds the key derivation takes. */
enum class UnlockStage { CHECKING, OPENING, LOADING }

/** Whether this phone can do fingerprint unlock and whether it is switched on for this vault. */
data class BiometricState(val available: Boolean = false, val enabled: Boolean = false)

/** One signed-in account's vault: set up, unlock, recover, lock. Mirrors VaultProvider.tsx. */
class VaultViewModel(app: Application, private val email: String) : AndroidViewModel(app) {
    private val container = (app as SipwiseApp).container
    private val cache = FileVaultCache.forContext(app, email)
    private val _ui = MutableStateFlow<VaultUi>(VaultUi.Checking)
    val ui: StateFlow<VaultUi> = _ui.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _stage = MutableStateFlow<UnlockStage?>(null)
    val stage: StateFlow<UnlockStage?> = _stage.asStateFlow()

    private val _biometric = MutableStateFlow(BiometricState())
    val biometric: StateFlow<BiometricState> = _biometric.asStateFlow()

    private var engineBridge: JsEngineBridge? = null

    /**
     * The view models of the screens in the current unlock. A fresh store per unlock (cleared on lock) so no screen keeps
     * a ledger whose engine the lock has closed, while still surviving a rotation or a fold of the phone.
     */
    var sessionStore = ViewModelStore()
        private set
    private var status: VaultStatus.Locked? = null
    private var prepared: PreparedVault? = null
    private var backgroundedAt: Long? = null

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _ui.value = VaultUi.Checking
            try {
                when (val found = loadVaultStatus(container.vaultTransport, cache)) {
                    VaultStatus.None -> {
                        container.analytics.reportAccountState(false)
                        _ui.value = VaultUi.NeedsSetup
                    }
                    is VaultStatus.Locked -> {
                        container.analytics.reportAccountState(true)
                        status = found
                        _biometric.value =
                            BiometricState(container.biometric.available(), container.biometric.has(email, found.vault.vaultId))
                        _ui.value = VaultUi.Locked(found.offline)
                    }
                }
            } catch (e: ApiRequestException) {
                _ui.value = VaultUi.Failed(e.message.orEmpty())
            }
        }
    }

    private suspend fun engine(): EngineClient {
        val bridge = engineBridge ?: JsEngineBridge.create(getApplication()).also { engineBridge = it }
        return EngineClient(bridge, onDied = { lock("engine-stopped") })
    }

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null
            try {
                block()
            } catch (e: VaultException) {
                _error.value = e.message
            } catch (e: ApiRequestException) {
                _error.value = e.message
            } catch (e: EngineUnavailableException) {
                _error.value = e.message
            } catch (e: ConflictException) {
                _error.value = e.message
            } finally {
                _busy.value = false
                _stage.value = null
            }
        }
    }

    fun startSetup(password: String) =
        run {
            val engine = engine()
            val draft = prepareVault(container.vaultTransport, EngineAccountRules(engine), password, cache)
            prepared = draft
            _ui.value = VaultUi.ConfirmRecovery(draft.recoverySecret)
        }

    /** The person confirmed they saved the recovery key: now the vault is created on the server. */
    fun confirmRecoverySaved() =
        run {
            val draft = checkNotNull(prepared) { "No vault is being created." }
            val session = draft.finish()
            container.analytics.track(Events.VAULT_CREATED)
            prepared = null
            open(session)
        }

    fun cancelSetup() {
        prepared?.discard()
        prepared = null
        _ui.value = VaultUi.NeedsSetup
    }

    /** [remember] stores the data key behind the fingerprint or face for next time (asked on the unlock screen). */
    fun unlock(
        password: String,
        remember: Boolean = false,
        activity: FragmentActivity? = null,
    ) = run {
        val locked = checkNotNull(status) { "Nothing to unlock." }
        _stage.value = UnlockStage.CHECKING
        val engine = engine()
        val session = unlockVault(container.vaultTransport, EngineAccountRules(engine), locked, UnlockSecret.Password(password), cache)
        container.analytics.track(Events.VAULT_UNLOCKED, "method" to "password")
        open(session)
        if (remember && activity != null) rememberBiometric(activity, session)
    }

    private suspend fun rememberBiometric(
        activity: FragmentActivity,
        session: VaultSession,
    ) {
        val key = session.exportKey()
        try {
            val app = getApplication<Application>()
            container.biometric.save(activity, email, session.vaultId, key, app.getString(R.string.biometric_enable_title), app.getString(R.string.biometric_cancel))
        } finally {
            key.fill(0)
        }
    }

    /** Opens the vault with the biometric-protected key. Cancelling the prompt leaves the password form as it was. */
    fun unlockWithBiometric(activity: FragmentActivity) =
        run {
            val locked = checkNotNull(status) { "Nothing to unlock." }
            val key = recallKey(activity, locked) ?: return@run
            _stage.value = UnlockStage.CHECKING
            try {
                open(openWithKey(container.vaultTransport, EngineAccountRules(engine()), locked, key, cache))
                container.analytics.track(Events.VAULT_UNLOCKED, "method" to "biometric")
            } catch (e: VaultException) {
                container.biometric.forget(email)
                _biometric.value = _biometric.value.copy(enabled = false)
                throw e
            }
        }

    private suspend fun recallKey(
        activity: FragmentActivity,
        locked: VaultStatus.Locked,
    ): ByteArray? {
        val app = getApplication<Application>()
        return try {
            container.biometric.recall(activity, email, locked.vault.vaultId, app.getString(R.string.biometric_unlock_title), app.getString(R.string.biometric_cancel))
        } catch (ignored: BiometricInvalidatedException) {
            _biometric.value = _biometric.value.copy(enabled = false)
            throw VaultException(VaultErrorCode.INVALID, app.getString(R.string.biometric_invalidated))
        }
    }

    /** Turns fingerprint unlock on or off from Settings while the vault is open. */
    fun setBiometric(
        activity: FragmentActivity,
        session: VaultSession,
        on: Boolean,
    ) = run {
        if (on) {
            rememberBiometric(activity, session)
        } else {
            container.biometric.forget(email)
        }
        _biometric.value = _biometric.value.copy(enabled = container.biometric.has(email, session.vaultId))
    }

    fun recover(
        recoveryKey: String,
        newPassword: String,
    ) = run {
        val locked = checkNotNull(status) { "Nothing to recover." }
        _stage.value = UnlockStage.CHECKING
        val engine = engine()
        val session = recoverWithKey(container.vaultTransport, EngineAccountRules(engine), locked, recoveryKey, newPassword, cache)
        open(session)
    }

    /** Lost both the password and the recovery key: the server deletes the vault and the person starts again. */
    fun erase() =
        run {
            container.vaultTransport.deleteVault()
            container.biometric.forget(email)
            cache.clear()
            _biometric.value = BiometricState(_biometric.value.available, false)
            status = null
            refresh()
        }

    private suspend fun open(session: VaultSession) {
        _stage.value = UnlockStage.OPENING
        val engine = engine()
        engine.call("account.load", mapOf("json" to session.account))
        session.onLock { dropEngine() }
        sessionStore.clear()
        sessionStore = ViewModelStore()
        _stage.value = UnlockStage.LOADING
        _ui.value = VaultUi.Unlocked(session, Ledger(engine, LedgerWriter(session.asStore(), engine), container.api))
    }

    private fun dropEngine() {
        sessionStore.clear()
        engineBridge?.close()
        engineBridge = null
    }

    fun lock(reason: String = "button") {
        if (reason != "button") EngineFailures.report("lock:$reason", IllegalStateException("Vault locked: $reason"))
        val current = _ui.value
        if (current is VaultUi.Unlocked) current.session.lock()
        dropEngine()
        if (current is VaultUi.Unlocked) refresh()
    }

    fun onBackgrounded(now: Long) {
        backgroundedAt = now
    }

    /** Returning from the background after the grace period locks the vault. */
    fun onForegrounded(now: Long) {
        if (shouldLockVault(backgroundedAt, now)) lock("after-background")
        backgroundedAt = null
    }

    override fun onCleared() {
        (ui.value as? VaultUi.Unlocked)?.session?.lock()
        dropEngine()
        prepared?.discard()
    }
}
