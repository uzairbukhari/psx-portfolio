// Backup export: the same JSON document the web's "Export backup" writes, so either app's file restores on the web.
import { today, type Portfolio } from '../../../lib/portfolio.ts';

/** Android's share intent fails on very large text, so bigger ledgers are exported from the website instead. */
export const BACKUP_SHARE_LIMIT_CHARS = 400_000;

export function backupDocument(portfolio: Portfolio, now: Date = new Date()) {
  return { schemaVersion: 1, kind: 'psx-portfolio-ledger', exportedAt: now.toISOString(), portfolio };
}

/** The text handed to the share sheet and the suggested file name, or a reason it cannot be shared. */
export function backupShare(portfolio: Portfolio, now: Date = new Date()): { ok: true; text: string; title: string } | { ok: false; reason: string } {
  const text = JSON.stringify(backupDocument(portfolio, now));
  if (text.length > BACKUP_SHARE_LIMIT_CHARS)
    return { ok: false, reason: 'Your ledger is too large to share as text from the phone. Use Settings > Export backup on the website.' };
  return { ok: true, text, title: `psx-portfolio-${today()}.json` };
}
