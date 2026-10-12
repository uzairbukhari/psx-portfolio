// Resets the fictional test account to the full known state: deletes its vault, creates a new one protected by the
// fixed test password, and saves the four-portfolio account from lib/test-seed/account.ts, through the real client code
// (the server only sees ciphertext). Safe by construction: it aborts unless the app reports being signed in as
// claude-test@sipwise.test, so it cannot touch a real account.
//
// Usage: node scripts/seed-test-account.mjs --target=local|staging [--url=...]
//   local   needs `npm run sandbox:dev` running (port 5191)
//   staging needs TEST_LOGIN_SECRET (environment or git-ignored .env.test.local)
import { assertTestAccount, httpVaultTransport, resolveTarget, signIn } from './test-env.mjs';
import { seedTestVault } from '../lib/test-seed/seed-vault.ts';
import { TEST_ACCOUNT_EMAIL, TEST_VAULT_PASSWORD } from '../lib/test-account.ts';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pktToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function seedTarget(targetName, urlOverride) {
  const target = resolveTarget(targetName, urlOverride);
  const cookie = await signIn(target);
  await assertTestAccount(target, cookie);
  const result = await seedTestVault(httpVaultTransport(target, cookie), pktToday());
  return { target, cookie, result };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  try {
    const { target, result } = await seedTarget(arg('target') ?? 'local', arg('url'));
    console.log(`Seeded ${target.url} as ${TEST_ACCOUNT_EMAIL} (revision ${result.revision}):`);
    for (const p of result.portfolios) console.log(`  ${p.name}: ${p.trades} trades, ${p.assets} other assets`);
    console.log(`Vault password: ${TEST_VAULT_PASSWORD}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
