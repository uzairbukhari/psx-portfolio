// Local test sandbox: its own empty D1 databases (.wrangler/sandbox, git-ignored) filled with synthetic public data,
// and a dev server (vite.sandbox.config.ts, port 5191) that signs every request in as the fictional test account.
// The real local databases behind `npm run dev` are never read or written.
//
//   node scripts/sandbox.mjs setup   create/refresh the config, apply migrations, load the public fixtures
//   node scripts/sandbox.mjs reset   delete the sandbox state, then setup again
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPublicFixtureSql } from '../lib/test-seed/public-fixtures.ts';
import { TEST_ACCOUNT_EMAIL } from '../lib/test-account.ts';

const root = process.cwd();
export const SANDBOX_DIR = path.join(root, '.wrangler/sandbox');
const CONFIG = path.join(SANDBOX_DIR, 'wrangler.json');
const STATE = path.join(SANDBOX_DIR, 'state');

const pktToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function sandboxConfig() {
  return {
    name: 'sipwise-sandbox',
    compatibility_date: '2026-05-22',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [
      { binding: 'DB', database_name: 'sandbox-public', database_id: '11111111-1111-4111-8111-111111111111', migrations_dir: path.join(root, 'drizzle') },
      { binding: 'VAULT_DB', database_name: 'sandbox-vault', database_id: '22222222-2222-4222-8222-222222222222', migrations_dir: path.join(root, 'drizzle-vault') },
    ],
    // Only ever in this git-ignored file: signs requests on 127.0.0.1 in as the fictional account.
    vars: { DEV_AUTH_EMAIL: TEST_ACCOUNT_EMAIL, DEV_AUTH_NAME: 'Claude Test', ALLOWED_EMAILS: '', APP_ENV: 'local-test' },
  };
}

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args, '--local', '--config', CONFIG, '--persist-to', STATE], {
    cwd: root,
    stdio: 'inherit',
    // Windows only finds npx (npx.cmd) through a shell.
    shell: process.platform === 'win32',
    env: { ...process.env, WRANGLER_LOG_PATH: path.join(SANDBOX_DIR, 'logs'), WRANGLER_SEND_METRICS: 'false' },
  });

function setup() {
  mkdirSync(SANDBOX_DIR, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(sandboxConfig(), null, 2));
  wrangler('d1', 'migrations', 'apply', 'DB');
  wrangler('d1', 'migrations', 'apply', 'VAULT_DB');
  const file = path.join(SANDBOX_DIR, 'fixtures.sql');
  writeFileSync(file, buildPublicFixtureSql(pktToday(), 'all').join('\n'));
  wrangler('d1', 'execute', 'DB', '--file', file);
  console.log(`\nSandbox ready. Start it with: npm run sandbox:dev   (http://127.0.0.1:5191, signed in as ${TEST_ACCOUNT_EMAIL})`);
}

function reset() {
  if (existsSync(SANDBOX_DIR)) rmSync(STATE, { recursive: true, force: true });
  setup();
}

const command = process.argv[2];
if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('sandbox.mjs')) {
  if (command === 'setup') setup();
  else if (command === 'reset') reset();
  else {
    console.error('Usage: node scripts/sandbox.mjs setup|reset');
    process.exit(1);
  }
}
