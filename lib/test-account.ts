// The one fictional account automated tests sign in as. The `.test` TLD can never belong to a real Google account,
// and the vault password below only ever protects fictional data, so committing it is fine.
export const TEST_ACCOUNT_EMAIL = 'claude-test@sipwise.test';
export const TEST_ACCOUNT_NAME = 'Claude Test';
export const TEST_VAULT_PASSWORD = 'fictional-test-vault-passphrase-2026';

export const isTestAccount = (email: string | null | undefined) =>
  (email ?? '').trim().toLowerCase() === TEST_ACCOUNT_EMAIL;
