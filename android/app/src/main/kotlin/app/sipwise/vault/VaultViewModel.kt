package app.sipwise.vault

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.SipwiseApp
import app.sipwise.data.FileVaultCache
import app.sipwise.engine.EngineUnavailableException
import app.sipwise.engine.JsEngineBridge
import app.sipwise.ledger.Ledger
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineAccountRules
import app.sipwise.session.EngineClient
import app.sipwise.session.LedgerWriter
import app.sipwise.session.PreparedVault
import app.sipwise.session.UnlockSecret
import app.sipwise.session.VaultSession
import app.sipwise.session.VaultStatus
import app.sipwise.session.asStore
import app.sipwise.session.loadVaultStatus
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

    private var engineBridge: JsEngineBridge? = null
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
                    VaultStatus.None -> _ui.value = VaultUi.NeedsSetup
                    is VaultStatus.Locked -> {
                        status = found
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
        return EngineClient(bridge)
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
            prepared = null
            open(session)
        }

    fun cancelSetup() {
        prepared?.discard()
        prepared = null
        _ui.value = VaultUi.NeedsSetup
    }

    fun unlock(password: String) =
        run {
            val locked = checkNotNull(status) { "Nothing to unlock." }
            val engine = engine()
            val session = unlockVault(container.vaultTransport, EngineAccountRules(engine), locked, UnlockSecret.Password(password), cache)
            open(session)
        }

    fun recover(
        recoveryKey: String,
        newPassword: String,
    ) = run {
        val locked = checkNotNull(status) { "Nothing to recover." }
        val engine = engine()
        val session = recoverWithKey(container.vaultTransport, EngineAccountRules(engine), locked, recoveryKey, newPassword, cache)
        open(session)
    }

    private suspend fun open(session: VaultSession) {
        val engine = engine()
        engine.call("account.load", mapOf("json" to session.account))
        session.onLock { dropEngine() }
        _ui.value = VaultUi.Unlocked(session, Ledger(engine, LedgerWriter(session.asStore(), engine), container.api))
    }

    private fun dropEngine() {
        engineBridge?.close()
        engineBridge = null
    }

    fun lock() {
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
        if (shouldLockVault(backgroundedAt, now)) lock()
        backgroundedAt = null
    }

    override fun onCleared() {
        (ui.value as? VaultUi.Unlocked)?.session?.lock()
        dropEngine()
        prepared?.discard()
    }
}
