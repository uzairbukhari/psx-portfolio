// Backup export: the same JSON document the web's "Export backup" writes, so either app's file restores on the web.
import { today, type Portfolio } from '../../../lib/portfolio.ts';
import type { PortfolioAccount } from '../../../lib/portfolio-account.ts';
import type { BackupPackage } from '../../../lib/vault-backup.ts';

/** Android's share intent fails on very large text, so bigger ledgers are exported from the website instead. */
export const BACKUP_SHARE_LIMIT_CHARS = 400_000;

export function backupDocument(portfolio: Portfolio, now: Date = new Date()) {
  return { schemaVersion: 1, kind: 'psx-portfolio-ledger', exportedAt: now.toISOString(), portfolio };
}

/** The text handed to the share sheet and the suggested file name, or a reason it cannot be shared. */
/** The READABLE export (plain JSON, not encrypted). Callers must confirm before sharing it. */
export function backupShare(portfolio: Portfolio, now: Date = new Date()): { ok: true; text: string; title: string } | { ok: false; reason: string } {
  const text = JSON.stringify(backupDocument(portfolio, now));
  if (text.length > BACKUP_SHARE_LIMIT_CHARS)
    return { ok: false, reason: 'Your ledger is too large to share as text from the phone. Use Settings > Export backup on the website.' };
  return { ok: true, text, title: `psx-portfolio-${today()}.json` };
}

/**
 * The default backup: the encrypted package (wrapped keys plus ciphertext). It reveals nothing without the vault
 * password or recovery key, so it is safe to put in Files, Drive or email.
 */
export function encryptedBackupShare(pkg: BackupPackage, now: Date = new Date()): { ok: true; text: string; title: string } | { ok: false; reason: string } {
  const text = JSON.stringify(pkg);
  if (text.length > BACKUP_SHARE_LIMIT_CHARS)
    return { ok: false, reason: 'Your backup is too large to share as text from the phone. Use Settings > Backup on the website.' };
  return { ok: true, text, title: `sipwise-encrypted-backup-${now.toISOString().slice(0, 10)}.json` };
}

export function accountBackupShare(account: PortfolioAccount): { ok: true; text: string; title: string } | { ok: false; reason: string } {
  const text = JSON.stringify({ kind: 'sipwise-portfolio-account-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), account });
  if (text.length > BACKUP_SHARE_LIMIT_CHARS) return { ok: false, reason: 'This account is too large to share as text. Export a backup from the website.' };
  return { ok: true, text, title: `sipwise-all-portfolios-${today()}.json` };
}
