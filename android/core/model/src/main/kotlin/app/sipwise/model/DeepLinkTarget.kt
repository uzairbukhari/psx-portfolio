package app.sipwise.model

/** Where a link or a tapped notification opens. */
sealed interface DeepLinkTarget {
    data object Today : DeepLinkTarget

    data object Portfolio : DeepLinkTarget

    data object Plan : DeepLinkTarget

    data object Activity : DeepLinkTarget

    data object More : DeepLinkTarget

    data object Inbox : DeepLinkTarget

    data object Insights : DeepLinkTarget

    data object Picks : DeepLinkTarget

    data object Targets : DeepLinkTarget

    data class Company(val ticker: String) : DeepLinkTarget
}

private val SYMBOL = Regex("^[A-Za-z0-9]{2,12}$")

/**
 * Maps a link's pieces (`sipwise://company/MEBL` is host `company` and path `MEBL`) to a screen. Old Expo paths keep
 * working: sip → Plan, alerts → Inbox, account → More, reports → Insights, history → Activity.
 */
fun parseDeepLink(
    host: String?,
    pathSegments: List<String>,
): DeepLinkTarget? {
    val parts = (listOfNotNull(host) + pathSegments).filter { it.isNotBlank() }
    val first = parts.firstOrNull()?.lowercase() ?: return DeepLinkTarget.Today
    return when (first) {
        "index", "today" -> DeepLinkTarget.Today
        "portfolio" -> DeepLinkTarget.Portfolio
        "plan", "sip" -> DeepLinkTarget.Plan
        "picks" -> DeepLinkTarget.Picks
        "targets" -> DeepLinkTarget.Targets
        "activity", "history" -> DeepLinkTarget.Activity
        "more", "account" -> DeepLinkTarget.More
        "inbox", "alerts" -> DeepLinkTarget.Inbox
        "reports", "insights" -> DeepLinkTarget.Insights
        "company" -> parts.getOrNull(1)?.takeIf { SYMBOL.matches(it) }?.let { DeepLinkTarget.Company(it.uppercase()) }
        else -> null
    }
}

/** The screen a push notification of this kind opens (the server sends a closed `kind`). */
fun pushTarget(kind: String?): DeepLinkTarget? =
    when (kind) {
        "market-update", "test" -> DeepLinkTarget.Inbox
        else -> null
    }
