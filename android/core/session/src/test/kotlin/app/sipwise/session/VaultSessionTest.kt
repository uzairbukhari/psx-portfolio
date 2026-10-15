package app.sipwise.session

import app.sipwise.network.ApiRequestException
import app.sipwise.vault.VaultCrypto
import app.sipwise.vault.VaultErrorCode
import app.sipwise.vault.VaultException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val PASSWORD = "correct horse battery staple"

private class FakeRules : AccountRules {
    override suspend fun blank() = """{"portfolios":[]}"""

    override suspend fun normalize(accountJson: String): String {
        require(accountJson.startsWith("{")) { "Not an account." }
        return accountJson
    }

    override suspend fun assertWritable(
        currentJson: String,
        nextJson: String,
    ) = check(!currentJson.contains("\"locked\"")) { "Locked." }
}

private class FakeServer : VaultTransport {
    var vault: app.sipwise.vault.VaultKeyMaterial? = null
    var portfolio: EncryptedPortfolioResponse? = null
    var offline = false

    private fun guard() {
        if (offline) throw ApiRequestException("offline", 0)
    }

    override suspend fun getVault(): VaultResponse = guard().let { VaultResponse(vault) }

    override suspend fun postVault(request: VaultSetupRequest): VaultSetupResponse {
        guard()
        vault = request.material.copy(createdAt = "2026-01-01T00:00:00Z")
        portfolio = EncryptedPortfolioResponse(request.material.vaultId, 1, request.envelope, "now")
        return VaultSetupResponse(vault!!, 1)
    }

    override suspend fun putWrappers(request: VaultWrappersRequest): VaultWrappersResponse {
        guard()
        if (request.expectedWrapperVersion != vault!!.wrapperVersion) throw ApiRequestException("stale", 409, "wrapper-conflict")
        vault =
            vault!!.copy(
                wrapperVersion = vault!!.wrapperVersion + 1,
                password = request.password ?: vault!!.password,
                recovery = request.recovery ?: vault!!.recovery,
            )
        return VaultWrappersResponse(vault!!.wrapperVersion)
    }

    override suspend fun deleteVault() = guard().also { vault = null }

    override suspend fun getPortfolio(): EncryptedPortfolioResponse {
        guard()
        return portfolio ?: throw ApiRequestException("none", 404, "no-vault")
    }

    override suspend fun putPortfolio(request: SaveEncryptedPortfolioRequest): SaveEncryptedPortfolioResponse {
        guard()
        if (request.expectedRevision != portfolio!!.revision) throw ApiRequestException("conflict", 409, "conflict")
        portfolio = EncryptedPortfolioResponse(portfolio!!.vaultId, request.expectedRevision + 1, request.envelope, "now")
        return SaveEncryptedPortfolioResponse(portfolio!!.revision)
    }
}

class VaultSessionTest {
    private val rules = FakeRules()
    private val server = FakeServer()
    private val crypto = VaultCrypto()

    private suspend fun created(): Pair<VaultSession, String> {
        val prepared = prepareVault(server, rules, PASSWORD)
        return prepared.finish() to prepared.recoverySecret
    }

    private suspend fun locked() = loadVaultStatus(server) as VaultStatus.Locked

    @Test
    fun createUnlockSaveAndReloadRoundTrip() =
        runTest {
            val (session, _) = created()
            assertEquals(1, session.revision)
            assertEquals(2, session.save("""{"portfolios":[1]}""", 1))
            session.lock()

            val reopened = unlockVault(server, rules, locked(), UnlockSecret.Password(PASSWORD))
            assertEquals(2, reopened.revision)
            assertEquals("""{"portfolios":[1]}""", reopened.account)
        }

    @Test
    fun wrongPasswordIsRejected() =
        runTest {
            created()
            val e = assertFailsWith<VaultException> { unlockVault(server, rules, locked(), UnlockSecret.Password("wrong password 12345")) }
            assertEquals(VaultErrorCode.WRONG_PASSWORD, e.code)
        }

    @Test
    fun staleSaveConflictsAndWritesNothing() =
        runTest {
            val (session, _) = created()
            session.save("""{"a":1}""", 1)
            assertFailsWith<ConflictException> { session.save("""{"a":2}""", 1) }
            assertEquals(2, server.portfolio!!.revision)
        }

    @Test
    fun serverSideRaceMapsTo409Conflict() =
        runTest {
            val (session, _) = created()
            server.portfolio = server.portfolio!!.copy(revision = 5)
            assertFailsWith<ConflictException> { session.save("""{"a":1}""", 1) }
        }

    @Test
    fun lockedSessionRefusesWork() =
        runTest {
            val (session, _) = created()
            var notified = false
            session.onLock { notified = true }
            session.lock()
            assertTrue(notified)
            assertFalse(session.active)
            assertFailsWith<VaultLockedException> { session.save("""{"a":1}""", 0) }
            assertFailsWith<VaultLockedException> { session.exportKey() }
        }

    @Test
    fun lockRulesBlockAnEditOfALockedPortfolio() =
        runTest {
            val (session, _) = created()
            session.save("""{"locked":true}""", 1)
            assertFailsWith<IllegalStateException> { session.save("""{"locked":false}""", 2) }
            assertEquals(3, session.save("""{"locked":false}""", 2, replaceAll = true))
        }

    @Test
    fun changePasswordKeepsTheSameDataKey() =
        runTest {
            val (session, _) = created()
            session.changePassword(PASSWORD, "another long passphrase 99")
            assertEquals(2, server.vault!!.wrapperVersion)
            session.lock()
            val again = unlockVault(server, rules, locked(), UnlockSecret.Password("another long passphrase 99"))
            assertEquals(1, again.revision)
            assertFailsWith<VaultException> { unlockVault(server, rules, locked(), UnlockSecret.Password(PASSWORD)) }
        }

    @Test
    fun recoveryKeyResetsThePassword() =
        runTest {
            val (session, recovery) = created()
            session.lock()
            val recovered = recoverWithKey(server, rules, locked(), recovery, "brand new passphrase 77")
            assertTrue(recovered.active)
            recovered.lock()
            unlockVault(server, rules, locked(), UnlockSecret.Password("brand new passphrase 77")).lock()
            // The old recovery key still works until it is replaced.
            unlockVault(server, rules, locked(), UnlockSecret.Recovery(recovery)).lock()
        }

    @Test
    fun replacedRecoveryKeyInvalidatesTheOldOne() =
        runTest {
            val (session, oldRecovery) = created()
            val draft = session.prepareRecovery()
            session.commitRecovery(draft)
            session.lock()
            assertFailsWith<VaultException> { unlockVault(server, rules, locked(), UnlockSecret.Recovery(oldRecovery)) }
            unlockVault(server, rules, locked(), UnlockSecret.Recovery(draft.recoverySecret)).lock()
        }

    @Test
    fun offlineUnlocksFromTheDeviceCacheAndRefusesRecovery() =
        runTest {
            val cache = MemoryCache()
            val prepared = prepareVault(server, rules, PASSWORD, cache)
            val session = prepared.finish()
            session.lock()
            server.offline = true
            val status = loadVaultStatus(server, cache) as VaultStatus.Locked
            assertTrue(status.offline)
            val offlineSession = unlockVault(server, rules, status, UnlockSecret.Password(PASSWORD), cache)
            assertTrue(offlineSession.offline)
            assertFailsWith<ApiRequestException> { recoverWithKey(server, rules, status, prepared.recoverySecret, "yet another passphrase 11", cache) }
        }

    @Test
    fun backupPackageCarriesWrappersAndCiphertext() =
        runTest {
            val (session, _) = created()
            val backup = session.backupPackage()
            assertEquals(BACKUP_KIND, backup.kind)
            assertEquals(1, backup.portfolio.revision)
            assertEquals(session.vaultId, backup.vault.vaultId)
            val key = crypto.unwrapWithPassword(backup.vault, PASSWORD)
            val plain = crypto.decryptPortfolio(key, backup.portfolio.envelope, backup.vault.vaultId, backup.vault.keyVersion, backup.portfolio.revision)
            assertEquals(rules.blank(), plain)
        }

    @Test
    fun noVaultReportsNone() =
        runTest {
            assertEquals(VaultStatus.None, loadVaultStatus(server))
        }
}

private class MemoryCache : VaultCache {
    var value: CachedVault? = null

    override suspend fun read() = value

    override suspend fun write(value: CachedVault) {
        this.value = value
    }

    override suspend fun clear() {
        value = null
    }
}
