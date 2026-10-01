import test from 'node:test';
import assert from 'node:assert/strict';
import { PROD_DATABASE_ID, assertStagingDatabase } from '../scripts/d1-rest.mjs';
import { buildSeedPortfolio, buildSeedStatement } from '../scripts/seed-staging.mjs';
import { validate, holdings, today } from '../lib/portfolio.ts';

const STAGING_ID = '11111111-2222-3333-4444-555555555555';

test('staging guard refuses missing and production database ids', () => {
  assert.throws(() => assertStagingDatabase(undefined), /D1_DATABASE_ID must be set/);
  assert.throws(() => assertStagingDatabase('  '), /must be set/);
  assert.throws(() => assertStagingDatabase(PROD_DATABASE_ID), /production/);
  assert.throws(() => assertStagingDatabase(` ${PROD_DATABASE_ID.toUpperCase()} `), /production/);
  assert.equal(assertStagingDatabase(STAGING_ID), STAGING_ID);
});

test('seed statement is blocked for prod/unset ids and built for staging', () => {
  const t = today();
  assert.throws(() => buildSeedStatement({ databaseId: PROD_DATABASE_ID, today: t }));
  assert.throws(() => buildSeedStatement({ databaseId: undefined, today: t }));
  const { sql, params } = buildSeedStatement({ databaseId: STAGING_ID, today: t });
  assert.match(sql, /INSERT INTO portfolios/);
  assert.equal(params[0], 'suzairbukhari@gmail.com');
  assert.equal(
    buildSeedStatement({ databaseId: STAGING_ID, email: ' Other@Example.com ', today: t }).params[0],
    'other@example.com',
  );
  assert.throws(() => buildSeedStatement({ databaseId: STAGING_ID, email: 'nope', today: t }));
});

test('seed portfolio passes ledger validation and yields sane holdings', () => {
  for (const day of [today(), '2026-01-31', '2026-03-01', '2027-12-05']) {
    if (day > today()) continue;
    const p = JSON.parse(JSON.stringify(buildSeedPortfolio(day)));
    validate(p);
    const held = holdings(p);
    assert.ok(held.length >= 5);
    assert.ok(p.trades.some((t) => t.kind === 'sell'));
    assert.ok(p.dividends.length >= 2);
    assert.ok(p.trades.every((t) => t.date < day));
  }
});
