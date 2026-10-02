import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { assertResetAllowed, resetUserData } from '../lib/staging-reset.ts';

test('production never allows the reset, whoever asks', () => {
  assert.throws(() => assertResetAllowed('production', true, 'RESET'), /only available on staging/);
  assert.throws(() => assertResetAllowed(undefined, true, 'RESET'), /only available on staging/);
});
test('staging requires a super admin and an explicit confirmation', () => {
  assert.throws(() => assertResetAllowed('staging', false, 'RESET'), /Not authorized/);
  assert.throws(() => assertResetAllowed('staging', true, 'yes'), /Type RESET/);
  assert.doesNotThrow(() => assertResetAllowed('staging', true, 'RESET'));
});
test('reset removes only the caller\'s portfolio and runs', async () => {
  const db = createD1();
  const now = new Date().toISOString();
  for (const user of ['me@x.com', 'other@x.com']) {
    db.sqlite.prepare('INSERT INTO portfolios (user_id,payload,revision,updated_at) VALUES (?,?,1,?)').run(user, '{}', now);
    db.sqlite.prepare("INSERT INTO monthly_recommendations (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,created_at,updated_at) VALUES (?,?,'2026-10',1,0,'[]','completed','m',9,?,?)").run(`r-${user}`, user, now, now);
    db.sqlite.prepare("INSERT INTO recommendation_attempts (id,recommendation_id,phase,cycle,batch_key,state,request,reserved_usd,created_at) VALUES (?,?,'pick',0,'final','completed','{}',0.1,?)").run(`a-${user}`, `r-${user}`, now);
  }
  await resetUserData(db, 'me@x.com');
  const count = (table, user) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'recommendation_attempts' ? 'id' : 'user_id'}=?`).get(table === 'recommendation_attempts' ? `a-${user}` : user).n;
  assert.equal(count('portfolios', 'me@x.com'), 0);
  assert.equal(count('monthly_recommendations', 'me@x.com'), 0);
  assert.equal(count('recommendation_attempts', 'me@x.com'), 0);
  assert.equal(count('portfolios', 'other@x.com'), 1);
  assert.equal(count('monthly_recommendations', 'other@x.com'), 1);
  assert.equal(count('recommendation_attempts', 'other@x.com'), 1);
});
