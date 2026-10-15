package app.sipwise

import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.data.Appearance
import app.sipwise.designsystem.SipwiseTheme

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Keep the decrypted portfolio out of the recents thumbnail.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)
        val preferences = (application as SipwiseApp).container.preferences
        setContent {
            val appearance by preferences.appearance.collectAsStateWithLifecycle()
            val dark =
                when (appearance) {
                    Appearance.SYSTEM -> isSystemInDarkTheme()
                    Appearance.LIGHT -> false
                    Appearance.DARK -> true
                }
            SipwiseTheme(darkTheme = dark) {
                SipwiseRoot()
            }
        }
    }
}
