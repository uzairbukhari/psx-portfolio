// Writes the FICTIONAL test account (four portfolios covering every asset class and record type, see
// lib/test-seed/account.ts) to a local file, in the whole-account backup format. It touches no database: portfolios
// are encrypted on the device, so the server can be seeded only through a vault. To seed a vault automatically use
// `node scripts/seed-test-account.mjs --target=local|staging`; to restore this file by hand, open the All portfolios
// view and use Settings > Restore a backup.
//
// Usage: node scripts/seed-staging.mjs [--out=staging-seed-ledger.json] [--dry-run]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildTestAccount, buildTestBackup } from '../lib/test-seed/account.ts';

/** The "AHL Core" portfolio of the test account, as a bare ledger. */
export function buildSeedPortfolio(today, now = new Date()) {
  return buildTestAccount(today, now).portfolios[0].portfolio;
}

/** The whole fictional account as a plain backup file a tester restores through the app. */
export function buildSeedBackup(today, now = new Date()) {
  return buildTestBackup(today, now);
}

const pktToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

function main() {
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) || 'staging-seed-ledger.json';
  const backup = buildSeedBackup(pktToday());
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(backup, null, 2));
    return;
  }
  writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log(`Wrote the fictional test account to ${out}. Restore it on the All portfolios view; it is encrypted on your device.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
