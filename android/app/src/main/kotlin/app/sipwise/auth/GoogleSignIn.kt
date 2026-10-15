package app.sipwise.auth

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import app.sipwise.BuildConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

class SignInCancelledException : Exception("Google sign-in was cancelled.")

class SignInFailedException(cause: Throwable) : Exception("Google sign-in did not work. Try again.", cause)

/** Google ID token from Credential Manager. The server verifies it; the same web client id the Expo app uses. */
class GoogleSignIn(private val appContext: Context) {
    private val manager = CredentialManager.create(appContext)

    /** [activityContext] must be an Activity: Credential Manager shows its account sheet on top of it. */
    suspend fun idToken(activityContext: Context): String {
        val option =
            GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
                .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        try {
            val credential = manager.getCredential(activityContext, request).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return GoogleIdTokenCredential.createFrom(credential.data).idToken
            }
            throw SignInFailedException(IllegalStateException("Unexpected credential type ${credential.type}"))
        } catch (e: GetCredentialCancellationException) {
            throw SignInCancelledException().also { it.initCause(e) }
        } catch (e: NoCredentialException) {
            throw SignInFailedException(e)
        } catch (e: GetCredentialException) {
            throw SignInFailedException(e)
        }
    }

    suspend fun signOut() {
        manager.clearCredentialState(ClearCredentialStateRequest())
    }
}
