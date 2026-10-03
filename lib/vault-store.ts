// Ciphertext storage for the private vault database (binding VAULT_DB). Every function takes the owner
// from the verified session and never decrypts anything. Free of Worker-only imports so it is testable
// against a real SQLite (tests/helpers/d1.mjs). Super-admin status is not a concept here: there is no
// code path that reads another owner's rows.
import {
  VAULT_FORMAT_VERSION,
  validateEnvelope,
  validateVaultKeyMaterial,
  type PasswordWrapper,
  type PortfolioEnvelope,
  type RecoveryWrapper,
  type VaultKeyMaterial,
} from './vault-crypto.ts';

export type VaultRow = {
  vault_id: string;
  format_version: number;
  key_version: number;
  wrapper_version: number;
  password_wrapper: string;
  recovery_wrapper: string;
  created_at: string;
  updated_at: string;
};

/** The owner key: the verified Google email, lower-cased. */
export const ownerKey = (email: string) => email.trim().toLowerCase();

export function materialFromRow(row: VaultRow): VaultKeyMaterial {
  const material = {
    vaultId: row.vault_id,
    formatVersion: row.format_version,
    keyVersion: row.key_version,
    wrapperVersion: row.wrapper_version,
    password: JSON.parse(row.password_wrapper),
    recovery: JSON.parse(row.recovery_wrapper),
  };
  validateVaultKeyMaterial(material);
  return material;
}

export async function readVault(db: D1Database, owner: string): Promise<(VaultKeyMaterial & { createdAt: string }) | null> {
  const row = await db
    .prepare('SELECT vault_id,format_version,key_version,wrapper_version,password_wrapper,recovery_wrapper,created_at,updated_at FROM vaults WHERE owner=?')
    .bind(ownerKey(owner))
    .first<VaultRow>();
  return row ? { ...materialFromRow(row), createdAt: row.created_at } : null;
}

export type StoredPortfolio = { envelope: PortfolioEnvelope; revision: number; updatedAt: string };

export async function readCiphertext(db: D1Database, owner: string): Promise<StoredPortfolio | null> {
  const row = await db
    .prepare('SELECT p.envelope AS envelope,p.revision AS revision,p.updated_at AS updated_at FROM vault_portfolios p JOIN vaults v ON v.vault_id=p.vault_id WHERE v.owner=?')
    .bind(ownerKey(owner))
    .first<{ envelope: string; revision: number; updated_at: string }>();
  if (!row) return null;
  const envelope = JSON.parse(row.envelope);
  validateEnvelope(envelope);
  return { envelope, revision: row.revision, updatedAt: row.updated_at };
}

export type SetupResult = 'created' | 'exists';

/**
 * Creates the vault and its encrypted blank portfolio (revision 1) in one atomic batch. A second setup for the
 * same owner, or a duplicate vault id, changes nothing and reports 'exists'.
 */
export async function setupVault(
  db: D1Database,
  owner: string,
  material: VaultKeyMaterial,
  envelope: PortfolioEnvelope,
  now = new Date().toISOString(),
): Promise<SetupResult> {
  validateVaultKeyMaterial(material);
  validateEnvelope(envelope);
  const key = ownerKey(owner);
  const [vault, portfolio] = await db.batch([
    db
      .prepare(
        'INSERT INTO vaults (vault_id,owner,format_version,key_version,wrapper_version,password_wrapper,recovery_wrapper,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?,?) ON CONFLICT DO NOTHING',
      )
      .bind(material.vaultId, key, VAULT_FORMAT_VERSION, material.keyVersion, JSON.stringify(material.password), JSON.stringify(material.recovery), now, now),
    // Only when the vault row above is this owner's and is new: a refused vault insert leaves no portfolio behind.
    db
      .prepare(
        'INSERT INTO vault_portfolios (vault_id,envelope,revision,updated_at) SELECT ?,?,1,? WHERE EXISTS (SELECT 1 FROM vaults WHERE vault_id=? AND owner=? AND created_at=?) AND NOT EXISTS (SELECT 1 FROM vault_portfolios WHERE vault_id=?)',
      )
      .bind(material.vaultId, JSON.stringify(envelope), now, material.vaultId, key, now, material.vaultId),
  ]);
  const created = Number(vault.meta.changes) > 0 && Number(portfolio.meta.changes) > 0;
  if (!created && Number(vault.meta.changes) > 0) {
    // Vault row inserted but the portfolio was refused: undo so no half-created vault remains.
    await db.prepare('DELETE FROM vaults WHERE vault_id=? AND owner=? AND NOT EXISTS (SELECT 1 FROM vault_portfolios WHERE vault_id=?)').bind(material.vaultId, key, material.vaultId).run();
  }
  return created ? 'created' : 'exists';
}

/**
 * Replaces the stored ciphertext only when the caller's revision is current. The envelope must already be
 * encrypted for expectedRevision+1 under the owner's vault id and current key version. Returns false on conflict.
 */
export async function saveCiphertext(db: D1Database, owner: string, envelope: PortfolioEnvelope, expectedRevision: number, now = new Date().toISOString()): Promise<boolean> {
  validateEnvelope(envelope);
  if (envelope.revision !== expectedRevision + 1) return false;
  const result = await db
    .prepare(
      `UPDATE vault_portfolios SET envelope=?,revision=?,updated_at=?
       WHERE vault_id=? AND revision=?
         AND EXISTS (SELECT 1 FROM vaults v WHERE v.vault_id=vault_portfolios.vault_id AND v.owner=? AND v.key_version=?)`,
    )
    .bind(JSON.stringify(envelope), expectedRevision + 1, now, envelope.vaultId, expectedRevision, ownerKey(owner), envelope.keyVersion)
    .run();
  return Number(result.meta.changes) > 0;
}

export type WrapperUpdate = { expectedWrapperVersion: number; password?: PasswordWrapper; recovery?: RecoveryWrapper };

/** Conditional wrapper replacement on its own version counter. Returns the new version, or null on conflict. */
export async function updateWrappers(db: D1Database, owner: string, update: WrapperUpdate, now = new Date().toISOString()): Promise<number | null> {
  const current = await readVault(db, owner);
  if (!current || current.wrapperVersion !== update.expectedWrapperVersion) return null;
  const next: VaultKeyMaterial = {
    ...current,
    wrapperVersion: current.wrapperVersion + 1,
    password: update.password ?? current.password,
    recovery: update.recovery ?? current.recovery,
  };
  validateVaultKeyMaterial(next);
  const result = await db
    .prepare('UPDATE vaults SET password_wrapper=?,recovery_wrapper=?,wrapper_version=wrapper_version+1,updated_at=? WHERE owner=? AND vault_id=? AND wrapper_version=?')
    .bind(JSON.stringify(next.password), JSON.stringify(next.recovery), now, ownerKey(owner), current.vaultId, update.expectedWrapperVersion)
    .run();
  return Number(result.meta.changes) > 0 ? next.wrapperVersion : null;
}

/** Permanent removal of the owner's vault and ciphertext (account deletion, or "reset vault" after both secrets are lost). */
export async function deleteVault(db: D1Database, owner: string): Promise<void> {
  const key = ownerKey(owner);
  await db.batch([
    db.prepare('DELETE FROM vault_portfolios WHERE vault_id IN (SELECT vault_id FROM vaults WHERE owner=?)').bind(key),
    db.prepare('DELETE FROM vaults WHERE owner=?').bind(key),
  ]);
}
