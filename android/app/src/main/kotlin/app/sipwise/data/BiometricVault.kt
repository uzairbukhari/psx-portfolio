package app.sipwise.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume

private const val KEYSTORE = "AndroidKeyStore"
private const val PREFS = "sipwise_biometric"
private const val TRANSFORM = "AES/GCM/NoPadding"
private const val GCM_TAG_BITS = 128
private const val KEY_BITS = 256
private const val DATA_KEY_BYTES = 32
private const val NAME_HEX_CHARS = 16

/** The fingerprint or face key was replaced or removed, so the stored vault key can never be read again. */
class BiometricInvalidatedException : Exception()

/**
 * Fingerprint / face unlock for the vault. After one password unlock, and only if the person opts in, the vault's data key is
 * encrypted with a Keystore key that needs a fresh biometric for every use (and is dropped by Android if the enrolled biometrics
 * change). The vault password stays the fallback and the only way to set up; signing out or a failed decrypt removes the key.
 */
class BiometricVault(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun available(): Boolean = BiometricManager.from(app).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    /** Whether a key is stored for this account's current vault (no prompt). */
    fun has(
        email: String,
        vaultId: String,
    ): Boolean = prefs.getString("${name(email)}.vault", null) == vaultId

    fun forget(email: String) {
        val name = name(email)
        prefs.edit {
            remove("$name.vault")
            remove("$name.iv")
            remove("$name.blob")
        }
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (store.containsAlias(name)) store.deleteEntry(name)
    }

    /** Stores [dataKey] behind the biometric. False (nothing stored) when the phone cannot do it or the prompt was cancelled. */
    suspend fun save(
        activity: FragmentActivity,
        email: String,
        vaultId: String,
        dataKey: ByteArray,
        title: String,
        cancel: String,
    ): Boolean {
        if (!available()) return false
        forget(email)
        val name = name(email)
        return try {
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, createKey(name)) }
            val ready = authenticate(activity, cipher, title, cancel) ?: return false.also { forget(email) }
            val sealed = ready.doFinal(dataKey)
            prefs.edit {
                putString("$name.iv", Base64.encodeToString(ready.iv, Base64.NO_WRAP))
                putString("$name.blob", Base64.encodeToString(sealed, Base64.NO_WRAP))
                putString("$name.vault", vaultId)
            }
            true
        } catch (ignored: java.security.GeneralSecurityException) {
            forget(email)
            false
        }
    }

    /** Asks for the biometric and returns the data key, or null (cancelled, nothing stored). Throws when the key was invalidated. */
    suspend fun recall(
        activity: FragmentActivity,
        email: String,
        vaultId: String,
        title: String,
        cancel: String,
    ): ByteArray? {
        val (iv, blob) = stored(email, vaultId) ?: return null
        val name = name(email)
        return try {
            val key = KeyStore.getInstance(KEYSTORE).apply { load(null) }.getKey(name, null) as? SecretKey ?: throw BiometricInvalidatedException()
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv)) }
            val ready = authenticate(activity, cipher, title, cancel) ?: return null
            ready.doFinal(blob).takeIf { it.size == DATA_KEY_BYTES }
        } catch (invalidated: KeyPermanentlyInvalidatedException) {
            forget(email)
            throw BiometricInvalidatedException().apply { initCause(invalidated) }
        } catch (ignored: java.security.GeneralSecurityException) {
            forget(email)
            throw BiometricInvalidatedException()
        }
    }

    private fun stored(
        email: String,
        vaultId: String,
    ): Pair<ByteArray, ByteArray>? {
        if (!has(email, vaultId)) return null
        val name = name(email)
        val iv = prefs.getString("$name.iv", null)?.let { Base64.decode(it, Base64.NO_WRAP) }
        val blob = prefs.getString("$name.blob", null)?.let { Base64.decode(it, Base64.NO_WRAP) }
        return if (iv != null && blob != null) iv to blob else null
    }

    /** Secure-store names keep the email out of them. */
    private fun name(email: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("sipwise-biometric-key/v1|${email.trim().lowercase()}".toByteArray())
        return "sipwise.vaultkey." + digest.joinToString("") { "%02x".format(it) }.take(NAME_HEX_CHARS)
    }

    private fun createKey(alias: String): SecretKey {
        val spec =
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply { init(spec.build()) }.generateKey()
    }

    private suspend fun authenticate(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
        cancel: String,
    ): Cipher? =
        suspendCancellableCoroutine { continuation ->
            val prompt =
                BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(activity),
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            if (continuation.isActive) continuation.resume(result.cryptoObject?.cipher)
                        }

                        override fun onAuthenticationError(
                            errorCode: Int,
                            errString: CharSequence,
                        ) {
                            if (continuation.isActive) continuation.resume(null)
                        }
                    },
                )
            val info =
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setNegativeButtonText(cancel)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }
}
