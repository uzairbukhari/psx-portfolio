package app.sipwise.push

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.sipwise.R
import app.sipwise.SipwiseApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Receives Firebase pushes. The content is generic by design (no ticker or amount); the app decides what applies after unlock. */
class SipwiseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        val container = (application as SipwiseApp).container
        if (!container.preferences.pushEnabled.value || container.sessions.token() == null) return
        scope.launch { runCatching { container.push.register(token) } }
    }

    /** Only called while the app is open; in the background the system shows the notification itself. */
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        val allowed = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!allowed) return
        ensureNotificationChannel(this)
        val built =
            NotificationCompat.Builder(this, DIVIDENDS_CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle(notification.title)
                .setContentText(notification.body)
                .setAutoCancel(true)
                .setContentIntent(launchIntent())
                .build()
        getSystemService(NotificationManager::class.java).notify(message.messageId.hashCode(), built)
    }

    private fun launchIntent(): PendingIntent? {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
