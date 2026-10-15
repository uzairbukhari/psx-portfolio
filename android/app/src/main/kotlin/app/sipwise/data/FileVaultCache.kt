package app.sipwise.data

import android.content.Context
import app.sipwise.network.ApiJson
import app.sipwise.session.CachedVault
import app.sipwise.session.VaultCache
import app.sipwise.session.isLegacyPlaintextCacheName
import app.sipwise.session.vaultCacheName
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Ciphertext-only cache on the phone so the vault can be opened offline. It holds the wrappers and the encrypted
 * portfolio, never a key, a password or readable data, and the file name is a hash rather than the email.
 */
class FileVaultCache(private val dir: File, email: String) : VaultCache {
    private val file = File(dir, vaultCacheName(email))

    override suspend fun read(): CachedVault? =
        withContext(Dispatchers.IO) {
            runCatching { if (file.exists()) ApiJson.decodeFromString(CachedVault.serializer(), file.readText()) else null }.getOrNull()
        }

    override suspend fun write(value: CachedVault) =
        withContext(Dispatchers.IO) {
            val temp = File(dir, "${file.name}.tmp")
            temp.writeText(ApiJson.encodeToString(CachedVault.serializer(), value))
            if (!temp.renameTo(file)) {
                file.delete()
                temp.renameTo(file)
            }
            Unit
        }

    override suspend fun clear() =
        withContext(Dispatchers.IO) {
            file.delete()
            Unit
        }

    companion object {
        fun forContext(
            context: Context,
            email: String,
        ) = FileVaultCache(context.cacheDir, email)

        /** Removes the readable portfolio files older versions of the app left behind. */
        fun purgeLegacy(context: Context): Int =
            context.cacheDir.listFiles().orEmpty().filter { isLegacyPlaintextCacheName(it.name) }.count { it.delete() }
    }
}
