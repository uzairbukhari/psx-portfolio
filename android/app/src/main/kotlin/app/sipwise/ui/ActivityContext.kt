package app.sipwise.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.fragment.app.FragmentActivity

/** The hosting activity behind a Compose [Context], which BiometricPrompt needs. */
fun Context.findFragmentActivity(): FragmentActivity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is FragmentActivity) return current
        current = current.baseContext
    }
    return null
}
