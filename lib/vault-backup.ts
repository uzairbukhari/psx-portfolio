// Encrypted backup packages. A package carries the vault's wrapped keys and the encrypted portfolio exactly as the
// server stores them, so it can be opened with the password or the recovery key without any server. Restoring
// decrypts and validates locally, then the caller re-encrypts the portfolio into the destination vault (its own
// vault id, key version and next revision): a backup is never uploaded as it is, and plaintext never leaves the device.
import type { PortfolioEnvelope, VaultKeyMaterial } from './vault-crypto.ts';
import { VaultError, decryptPortfolio, unwrapWithPassword, unwrapWithRecovery, validateEnvelope, validateVaultKeyMaterial } from './vault-crypto.ts';
import { validate, type Portfolio } from './portfolio.ts';
import { normalizeAccount, type PortfolioAccount } from './portfolio-account.ts';

export const BACKUP_KIND = 'sipwise-encrypted-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 6_000_000;

export type BackupPackage = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  vault: VaultKeyMaterial;
  portfolio: { revision: number; envelope: PortfolioEnvelope };
};

export function createBackupPackage(vault: VaultKeyMaterial, stored: { revision: number; envelope: PortfolioEnvelope }, now = new Date()): BackupPackage {
  validateVaultKeyMaterial(vault);
  validateEnvelope(stored.envelope);
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt: now.toISOString(), vault, portfolio: { revision: stored.revision, envelope: stored.envelope } };
}

/** The file contents of a plain (readable!) ledger backup, as older versions of the app exported. */
export type PlainBackup = { kind: 'psx-portfolio-ledger'; schemaVersion: 1; portfolio: Portfolio };

export type ParsedBackup = { type: 'encrypted'; backup: BackupPackage } | { type: 'plain'; portfolio: Portfolio } | { type: 'account'; account: PortfolioAccount };

/** Recognises either backup kind and validates its shape. Throws a plain-language error otherwise. */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new VaultError('too-large', 'That backup file is too large.');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new VaultError('invalid', 'That file is not a backup this app can read.');
  }
  if (data?.kind === BACKUP_KIND) {
    if (data.version !== BACKUP_VERSION) throw new VaultError('unsupported', 'That backup was made by a newer version of the app.');
    const backup = data as unknown as BackupPackage;
    validateVaultKeyMaterial(backup.vault);
    validateEnvelope(backup.portfolio?.envelope);
    if (!Number.isInteger(backup.portfolio.revision) || backup.portfolio.revision < 0) throw new VaultError('invalid', 'That backup is damaged.');
    return { type: 'encrypted', backup };
  }
  if (data?.kind === 'sipwise-portfolio-account-backup') {
    if (data.schemaVersion !== 1) throw new VaultError('unsupported', 'Update the app to restore this backup.');
    return { type: 'account', account: normalizeAccount(data.account) };
  }
  if (data?.kind === 'psx-portfolio-ledger' && data.schemaVersion === 1) {
    validate(data.portfolio as Portfolio);
    return { type: 'plain', portfolio: data.portfolio as Portfolio };
  }
  throw new VaultError('invalid', 'Choose a portfolio-ledger backup, not a company research file.');
}

/** Decrypts a package with ITS password or recovery key (which may differ from the current vault's) and validates the result. */
export async function openAccountBackup(backup: BackupPackage, secret: { password: string } | { recovery: string }): Promise<PortfolioAccount> {
  const key = 'password' in secret ? await unwrapWithPassword(backup.vault, secret.password) : await unwrapWithRecovery(backup.vault, secret.recovery);
  try {
    const text = await decryptPortfolio(key, backup.portfolio.envelope, { vaultId: backup.vault.vaultId, keyVersion: backup.vault.keyVersion, revision: backup.portfolio.revision });
    return normalizeAccount(JSON.parse(text));
  } finally {
    key.fill(0);
  }
}

/** Legacy single-ledger callers must never silently drop the rest of a collection. */
export async function openBackup(backup: BackupPackage, secret: { password: string } | { recovery: string }): Promise<Portfolio> {
  const account = await openAccountBackup(backup, secret);
  if (account.portfolios.length !== 1) throw new Error('This backup contains multiple portfolios. Restore it as an account backup.');
  return account.portfolios[0].portfolio;
}
