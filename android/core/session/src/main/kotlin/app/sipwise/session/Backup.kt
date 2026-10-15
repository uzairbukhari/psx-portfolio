package app.sipwise.session

import app.sipwise.vault.PortfolioEnvelope
import app.sipwise.vault.VaultKeyMaterial
import app.sipwise.vault.validateEnvelope
import app.sipwise.vault.validateVaultKeyMaterial
import kotlinx.serialization.Serializable
import java.time.Instant

const val BACKUP_KIND = "sipwise-encrypted-backup"
const val BACKUP_VERSION = 1

@Serializable
data class BackupPortfolio(val revision: Int, val envelope: PortfolioEnvelope)

/** Mirrors lib/vault-backup.ts: the vault's wrapped keys and ciphertext exactly as the server stores them. */
@Serializable
data class BackupPackage(
    val kind: String,
    val version: Int,
    val exportedAt: String,
    val vault: VaultKeyMaterial,
    val portfolio: BackupPortfolio,
)

fun createBackupPackage(
    vault: VaultKeyMaterial,
    revision: Int,
    envelope: PortfolioEnvelope,
    now: Instant = Instant.now(),
): BackupPackage {
    validateVaultKeyMaterial(vault)
    validateEnvelope(envelope)
    return BackupPackage(BACKUP_KIND, BACKUP_VERSION, now.toString(), vault, BackupPortfolio(revision, envelope))
}

/** Android's share sheet fails on very large text; bigger ledgers are exported from the website instead. */
const val BACKUP_SHARE_LIMIT_CHARS = 400_000

/** The text and suggested file name of an export. */
data class BackupShare(val text: String, val title: String)

/**
 * The default backup: the encrypted package (wrapped keys plus ciphertext). It reveals nothing without the vault
 * password or recovery key. Null when it is too large to share from the phone.
 */
fun encryptedBackupShare(
    json: String,
    now: Instant = Instant.now(),
): BackupShare? =
    if (json.length > BACKUP_SHARE_LIMIT_CHARS) null else BackupShare(json, "sipwise-encrypted-backup-${now.toString().take(DATE_LENGTH)}.json")

private const val DATE_LENGTH = 10
