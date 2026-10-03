import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLACEHOLDER_ID, VAULT_DB_NAMES, configuredId, findByName, patchConfig } from '../scripts/ensure-vault-db.mjs';

const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc';

test('both vault databases are configured, named per environment and start as placeholders', () => {
  for (const name of Object.values(VAULT_DB_NAMES)) assert.equal(configuredId(config, name), PLACEHOLDER_ID, name);
  assert.equal(configuredId(config, 'nope'), null);
});

test('patching changes only the vault database id and keeps every other id', () => {
  const patched = patchConfig(config, VAULT_DB_NAMES.staging, ID);
  assert.equal(configuredId(patched, VAULT_DB_NAMES.staging), ID);
  assert.equal(configuredId(patched, VAULT_DB_NAMES.production), PLACEHOLDER_ID);
  assert.equal(configuredId(patched, 'psx-portfolio-sip'), 'f72a6264-371b-49ff-89e3-20eef1ce2b19');
  assert.equal(configuredId(patched, 'psx_portfolio_sip_staging'), 'f4ee7f4b-bfe7-4dc3-95ab-475917aee59b');
  assert.throws(() => patchConfig(config, VAULT_DB_NAMES.staging, 'not-an-id'));
  assert.throws(() => patchConfig(config, 'psx-missing', ID));
});

test('database lookup is by exact name and refuses ambiguity', () => {
  assert.equal(findByName(JSON.stringify([{ name: 'a', uuid: ID }, { name: 'b', uuid: 'x' }]), 'a'), ID);
  assert.equal(findByName('[]', 'a'), null);
  assert.throws(() => findByName(JSON.stringify([{ name: 'a', uuid: ID }, { name: 'a', uuid: 'y' }]), 'a'));
});

test('the vault database is bound only to the web Worker, never to the quote-refresh Worker', () => {
  const worker = readFileSync(new URL('../workers/quote-refresh/wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(!/VAULT_DB|vault/i.test(worker));
});
