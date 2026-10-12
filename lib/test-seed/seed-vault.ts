// Puts the fictional test account into a vault through the real client path: keys and ciphertext are made here, the
// server only ever sees ciphertext. Used by scripts/seed-test-account.mjs (over HTTP) and by tests (in-process).
import { prepareVault, type VaultSession, type VaultTransport } from '../vault-client.ts';
import { TEST_VAULT_PASSWORD } from '../test-account.ts';
import { buildTestAccount } from './account.ts';

export type SeedResult = { revision: number; portfolios: { id: string; name: string; trades: number; assets: number }[]; recoverySecret: string };

/** Deletes the signed-in account's vault (if any), creates a fresh one with the fixed test password, and saves the account. */
export async function seedTestVault(transport: VaultTransport, today: string, now: Date = new Date()): Promise<SeedResult> {
  const existing = await transport.getVault();
  if (existing.vault) await transport.deleteVault();
  const prepared = await prepareVault(transport, TEST_VAULT_PASSWORD);
  const session: VaultSession = await prepared.finish();
  const account = buildTestAccount(today, now);
  const revision = await session.saveAccount(account, session.revision, { replaceAll: true });
  session.lock();
  return {
    revision,
    recoverySecret: prepared.recoverySecret,
    portfolios: account.portfolios.map((p) => ({ id: p.id, name: p.name, trades: p.portfolio.trades.length, assets: p.portfolio.assets?.length ?? 0 })),
  };
}
