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
