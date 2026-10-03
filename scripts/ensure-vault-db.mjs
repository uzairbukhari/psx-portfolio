// Makes sure the PRIVATE vault D1 database for an environment exists and that wrangler.jsonc points at it.
//   node scripts/ensure-vault-db.mjs --env staging|production            report only (no changes)
//   node scripts/ensure-vault-db.mjs --env staging --create              create when missing, patch wrangler.jsonc in place
// Names are fixed per environment so this can never pick a public/other database. It never touches data.
// Needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN (D1 edit) for the wrangler calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const VAULT_DB_NAMES = { staging: 'psx_portfolio_sip_staging_vault', production: 'psx-portfolio-sip-vault' };
export const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database_id configured right after `"database_name": "<name>"`, or null when the name is absent. */
export function configuredId(text, name) {
  const at = text.indexOf(`"database_name": "${name}"`);
  if (at < 0) return null;
  const match = /"database_id":\s*"([^"]+)"/.exec(text.slice(at));
  return match ? match[1] : null;
}

/** Replaces that id in place. Throws when the entry is missing or the id is not a UUID. */
export function patchConfig(text, name, id) {
  if (!UUID.test(id)) throw new Error('Not a database id.');
  const at = text.indexOf(`"database_name": "${name}"`);
  if (at < 0) throw new Error(`wrangler.jsonc has no database named ${name}.`);
  const head = text.slice(0, at), tail = text.slice(at);
  return head + tail.replace(/("database_id":\s*")[^"]+(")/, `$1${id}$2`);
}

/** Finds a database by exact name in the JSON that `wrangler d1 list --json` prints. */
export function findByName(listJson, name) {
  const rows = JSON.parse(listJson);
  const hits = (Array.isArray(rows) ? rows : []).filter((row) => row?.name === name);
  if (hits.length > 1) throw new Error(`More than one database is named ${name}. Refusing to guess.`);
  return hits[0]?.uuid ?? hits[0]?.id ?? null;
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

export function main(argv = process.argv.slice(2)) {
  const env = argv.find((a) => a.startsWith('--env='))?.slice(6) ?? argv[argv.indexOf('--env') + 1];
  const name = VAULT_DB_NAMES[env];
  if (!name) throw new Error('Pass --env staging or --env production.');
  const config = 'wrangler.jsonc';
  let text = readFileSync(config, 'utf8');
  const configured = configuredId(text, name);
  if (configured === null) throw new Error(`${config} has no ${name} entry.`);
  let id = findByName(wrangler(['d1', 'list', '--json']), name);
  if (!id) {
    if (!argv.includes('--create')) {
      console.log(`${name}: does not exist yet (run again with --create).`);
      return { name, id: null, configured };
    }
    wrangler(['d1', 'create', name]);
    id = findByName(wrangler(['d1', 'list', '--json']), name);
    if (!id) throw new Error(`Created ${name} but could not find it afterwards.`);
    console.log(`${name}: created.`);
  }
  if (configured !== id) {
    text = patchConfig(text, name, id);
    writeFileSync(config, text);
    console.log(`${name}: wrangler.jsonc now uses ${id}${configured === PLACEHOLDER_ID ? '' : ` (was ${configured})`}. Commit this id for ${env} deploys.`);
  } else console.log(`${name}: ${id} (already configured).`);
  return { name, id, configured };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
