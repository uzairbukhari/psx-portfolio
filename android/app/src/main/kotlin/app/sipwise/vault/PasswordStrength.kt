package app.sipwise.vault

/** The vault password rule shown while typing: advice only, the server-side and engine rules are unchanged. */
const val MIN_PASSWORD_LENGTH = 15

enum class Strength(val level: Int) { NONE(0), WEAK(1), FAIR(2), GOOD(3), STRONG(4) }

data class PasswordCheck(
    val strength: Strength,
    val longEnough: Boolean,
    val notObvious: Boolean,
)

private val COMMON = listOf("password", "qwerty", "123456", "letmein", "iloveyou", "sipwise", "welcome", "admin")
private const val LONG = 20
private const val MIN_WORDS = 3
private const val MIN_CLASSES = 3

private fun classes(password: String): Int =
    listOf(
        password.any { it.isLowerCase() },
        password.any { it.isUpperCase() },
        password.any { it.isDigit() },
        password.any { !it.isLetterOrDigit() && !it.isWhitespace() },
    ).count { it }

private fun obvious(
    password: String,
    email: String,
): Boolean {
    val lower = password.lowercase()
    val local = email.substringBefore('@').lowercase()
    return (local.length >= 3 && lower.contains(local)) ||
        COMMON.any { lower.contains(it) } ||
        password.toSet().size <= 2
}

/** How strong [password] reads, and the two plain checks the screen ticks off. */
fun checkPassword(
    password: String,
    email: String,
): PasswordCheck {
    if (password.isEmpty()) return PasswordCheck(Strength.NONE, longEnough = false, notObvious = true)
    val longEnough = password.length >= MIN_PASSWORD_LENGTH
    val notObvious = !obvious(password, email)
    val words = password.split(' ', '-', '_', '.').count { it.isNotBlank() }
    val strength =
        when {
            !longEnough || !notObvious -> Strength.WEAK
            password.length >= LONG && (words >= MIN_WORDS || classes(password) >= MIN_CLASSES) -> Strength.STRONG
            password.length >= LONG || classes(password) >= 2 || words >= MIN_WORDS -> Strength.GOOD
            else -> Strength.FAIR
        }
    return PasswordCheck(strength, longEnough, notObvious)
}
