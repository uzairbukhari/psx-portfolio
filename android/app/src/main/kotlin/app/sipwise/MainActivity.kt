package app.sipwise

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sipwise.data.Appearance
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.model.parseDeepLink
import app.sipwise.model.pushTarget

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Keep the decrypted portfolio out of the recents thumbnail.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)
        val preferences = (application as SipwiseApp).container.preferences
        handleLink(intent)
        setContent {
            val appearance by preferences.appearance.collectAsStateWithLifecycle()
            val dark =
                when (appearance) {
                    Appearance.SYSTEM -> isSystemInDarkTheme()
                    Appearance.LIGHT -> false
                    Appearance.DARK -> true
                }
            SipwiseTheme(darkTheme = dark) {
                // One themed surface under every screen, so text outside a Scaffold still follows light and dark.
                Surface(Modifier.fillMaxSize()) { SipwiseRoot() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** A `sipwise://` link or a tapped notification waits in the container until the unlocked app can open it. */
    private fun handleLink(intent: Intent?) {
        val data = intent?.data
        val target =
            if (data != null) parseDeepLink(data.host, data.pathSegments.orEmpty()) else pushTarget(intent?.getStringExtra("kind"))
        if (target != null) (application as SipwiseApp).container.pendingLink.value = target
    }
}
