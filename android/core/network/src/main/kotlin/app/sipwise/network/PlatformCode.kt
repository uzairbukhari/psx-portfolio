package app.sipwise.network

/** Cloudflare error pages (not the app's own JSON errors). Mirrors lib/platform-errors.ts. */
enum class PlatformCode(val wire: String, val message: String) {
    WORKER_LIMIT("cf_worker_limit", "Sipwise is busy right now. Please try again in a minute."),
    DAILY_LIMIT("cf_daily_limit", "Sipwise has reached its daily capacity. It resets within a day; please try again later."),
    RATE_LIMITED("cf_rate_limited", "Too many requests. Please wait a moment and try again."),
    TIMEOUT("cf_timeout", "Sipwise took too long to answer. Please try again."),
    UNAVAILABLE("cf_unavailable", "This is temporarily unavailable. Please try again shortly."),
}

private const val SNIPPET_CHARS = 4000
private val JSON_START = Regex("^\\s*[\\[{]")
private val DAILY = Regex("1027|free tier|daily request limit|exceeded.*(daily|request) limit", RegexOption.IGNORE_CASE)
private val WORKER = Regex("1102|exceeded resource limits|exceeded (cpu|memory)|resource limits", RegexOption.IGNORE_CASE)
private val RATE = Regex("1015|rate.?limited", RegexOption.IGNORE_CASE)
private val TIMED_OUT = Regex("\\b52[234]\\b|timed out", RegexOption.IGNORE_CASE)
private val DOWN = Regex("cloudflare|error code:? *5\\d\\d", RegexOption.IGNORE_CASE)
private val TIMEOUT_STATUSES = setOf(504, 522, 523, 524)
private val DOWN_STATUSES = setOf(502, 503, 520, 521, 530)

/** Maps a non-JSON failure to a platform code; null for success, for the app's own JSON and for anything unclear. */
fun classifyPlatformResponse(
    status: Int,
    text: String,
): PlatformCode? {
    if (status in 1..399) return null
    val body = text.take(SNIPPET_CHARS)
    return when {
        JSON_START.containsMatchIn(body) -> null
        DAILY.containsMatchIn(body) -> PlatformCode.DAILY_LIMIT
        WORKER.containsMatchIn(body) -> PlatformCode.WORKER_LIMIT
        status == 429 || RATE.containsMatchIn(body) -> PlatformCode.RATE_LIMITED
        status in TIMEOUT_STATUSES || TIMED_OUT.containsMatchIn(body) -> PlatformCode.TIMEOUT
        status in DOWN_STATUSES || DOWN.containsMatchIn(body) -> PlatformCode.UNAVAILABLE
        else -> null
    }
}
