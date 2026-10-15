package app.sipwise.session

import app.sipwise.network.ApiRequestException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionCleanupTest {
    @Test
    fun everyStepRunsEvenWhenOneFails() =
        runTest {
            val ran = mutableListOf<String>()

            suspend fun step(name: String) = ran.add(name).let { Unit }
            clearLocalState(
                LocalCleanup(
                    email = "a@b.c",
                    clearToken = { step("token") },
                    clearProfile = { error("broken store") },
                    googleSignOut = { step("google") },
                    clearQueries = { step("queries") },
                    clearPortfolioCache = { step("cache:$it") },
                    clearPushPreference = { step("push") },
                ),
            )
            assertEquals(listOf("token", "google", "queries", "cache:a@b.c", "push"), ran)
        }

    @Test
    fun noEmailSkipsOnlyTheCacheStep() =
        runTest {
            var cleared = false
            clearLocalState(LocalCleanup(null, {}, {}, {}, {}, { cleared = true }, {}))
            assertFalse(cleared)
        }

    @Test
    fun offlineRevokeIsQueuedAndServerRejectionIsNot() =
        runTest {
            val queued = mutableListOf<String>()
            assertEquals(SignOutResult.NONE, signOutRemote(null, { }, { }))
            assertEquals(SignOutResult.REVOKED, signOutRemote("t", { }, { }))
            assertEquals(SignOutResult.QUEUED, signOutRemote("t", { throw ApiRequestException("x", 0) }, { queued += it }))
            assertEquals(SignOutResult.QUEUED, signOutRemote("t", { throw ApiRequestException("x", 503) }, { queued += it }))
            assertEquals(SignOutResult.REVOKED, signOutRemote("t", { throw ApiRequestException("x", 401) }, { queued += "no" }))
            assertEquals(listOf("t", "t"), queued)
        }

    @Test
    fun pendingSignOutIsRetriedUntilTheServerAnswers() =
        runTest {
            var cleared = false
            assertFalse(retryPendingSignOut({ null }, { }, { }))
            assertTrue(retryPendingSignOut({ "t" }, { throw ApiRequestException("x", 0) }, { cleared = true }))
            assertFalse(cleared)
            assertFalse(retryPendingSignOut({ "t" }, { throw ApiRequestException("gone", 404) }, { cleared = true }))
            assertTrue(cleared)
        }

    @Test
    fun cacheNamesMatchTheExpoApp() {
        assertEquals("vault-e0b581958ea916bf.json", vaultCacheName("Person@Example.com"))
        assertEquals(vaultCacheName("person@example.com"), vaultCacheName(" Person@Example.com "))
        assertEquals("vault-10160c38cce04c93.json", vaultCacheName("a@b.c"))
        assertTrue(isLegacyPlaintextCacheName("portfolio-person_example_com.json"))
        assertFalse(isLegacyPlaintextCacheName(vaultCacheName("a@b.c")))
    }

    @Test
    fun lockPolicyMatchesTheExpoApp() {
        assertFalse(shouldLockVault(null, 1_000_000))
        assertFalse(shouldLockVault(0, 59_999))
        assertTrue(shouldLockVault(0, 60_000))
        assertTrue(coversVault(unlocked = true, appActive = false))
        assertFalse(coversVault(unlocked = false, appActive = false))
        assertFalse(coversVault(unlocked = true, appActive = true))
    }
}
