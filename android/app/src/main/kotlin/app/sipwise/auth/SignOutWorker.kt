package app.sipwise.auth

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.sipwise.SipwiseApp
import app.sipwise.session.retryPendingSignOut
import java.util.concurrent.TimeUnit

private const val WORK_NAME = "pending-sign-out"
private const val BACKOFF_SECONDS = 30L

/** Finishes a queued server-side sign-out as soon as the phone is online, even if the app is not opened again. */
class SignOutWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as SipwiseApp).container
        val sessions = container.sessions
        val stillPending =
            retryPendingSignOut(
                read = { sessions.pendingSignOut() },
                revoke = { container.revokeSession(it) },
                clear = { sessions.clearPendingSignOut() },
            )
        return if (stillPending) Result.retry() else Result.success()
    }

    companion object {
        /** Queues the retry; running it twice keeps the one already waiting. */
        fun schedule(context: Context) {
            val request =
                OneTimeWorkRequestBuilder<SignOutWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                    .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
