package app.sipwise.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Light, dark, or whatever the phone is set to. */
enum class Appearance(val wire: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark"),
    ;

    companion object {
        fun parse(value: String?): Appearance = entries.firstOrNull { it.wire == value } ?: SYSTEM
    }
}

private const val PREFS = "sipwise_prefs"
private const val KEY_APPEARANCE = "appearance"
private const val KEY_PUSH = "pushEnabled"

/** Device preferences (not account data), so they survive sign-out like the Expo app's. */
class Preferences(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val _appearance = MutableStateFlow(Appearance.parse(prefs.getString(KEY_APPEARANCE, null)))
    val appearance: StateFlow<Appearance> = _appearance.asStateFlow()

    private val _pushEnabled = MutableStateFlow(prefs.getBoolean(KEY_PUSH, false))
    val pushEnabled: StateFlow<Boolean> = _pushEnabled.asStateFlow()

    fun setPushEnabled(value: Boolean) {
        prefs.edit { putBoolean(KEY_PUSH, value) }
        _pushEnabled.value = value
    }

    fun setAppearance(value: Appearance) {
        prefs.edit { putString(KEY_APPEARANCE, value.wire) }
        _appearance.value = value
    }
}
