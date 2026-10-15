package app.sipwise.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeepLinkTest {
    @Test
    fun `maps screens and the old Expo paths`() {
        assertEquals(DeepLinkTarget.Plan, parseDeepLink("sip", emptyList()))
        assertEquals(DeepLinkTarget.Inbox, parseDeepLink("alerts", emptyList()))
        assertEquals(DeepLinkTarget.More, parseDeepLink(null, listOf("account")))
        assertEquals(DeepLinkTarget.Insights, parseDeepLink("reports", emptyList()))
        assertEquals(DeepLinkTarget.Today, parseDeepLink(null, emptyList()))
    }

    @Test
    fun `opens a company by symbol and rejects anything else`() {
        assertEquals(DeepLinkTarget.Company("MEBL"), parseDeepLink("company", listOf("mebl")))
        assertEquals(DeepLinkTarget.Company("MEBL"), parseDeepLink(null, listOf("company", "MEBL")))
        assertNull(parseDeepLink("company", listOf("../etc")))
        assertNull(parseDeepLink("company", emptyList()))
        assertNull(parseDeepLink("nope", emptyList()))
    }

    @Test
    fun `a market update push opens the inbox`() {
        assertEquals(DeepLinkTarget.Inbox, pushTarget("market-update"))
        assertNull(pushTarget("other"))
        assertNull(pushTarget(null))
    }
}
