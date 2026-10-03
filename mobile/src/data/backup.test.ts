import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { BACKUP_SHARE_LIMIT_CHARS, backupDocument, backupShare } from './backup.ts';

test('backup uses the web export format and round-trips the portfolio', () => {
  const p = blankPortfolio();
  p.taxProfile = { filerStatus: 'non-filer' };
  const result = backupShare(p, new Date('2026-10-02T08:00:00Z'));
  assert.ok(result.ok);
  const doc = JSON.parse(result.text);
  assert.deepEqual(Object.keys(doc), ['schemaVersion', 'kind', 'exportedAt', 'portfolio']);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.kind, 'psx-portfolio-ledger');
  assert.equal(doc.exportedAt, '2026-10-02T08:00:00.000Z');
  assert.deepEqual(doc.portfolio, p);
  validate(doc.portfolio);
  assert.match(result.title, /^psx-portfolio-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(backupDocument(p, new Date(0)).portfolio, p);
});

test('an oversized ledger is refused with a pointer to the website', () => {
  const p = blankPortfolio();
  p.trades = Array.from({ length: 4000 }, (_, i) => ({ id: `t${i}`, ticker: 'AAA', kind: 'buy' as const, date: '2026-01-01', shares: 1, price: 1, fees: 0, month: '2026-01', note: 'x'.repeat(60) }));
  const result = backupShare(p);
  assert.ok(JSON.stringify(p).length > BACKUP_SHARE_LIMIT_CHARS);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /website/);
});

test('the encrypted backup is shared as the package itself, never as readable JSON', async () => {
  const { encryptedBackupShare } = await import('./backup.ts');
  const pkg = { kind: 'sipwise-encrypted-backup', version: 1, vault: {}, portfolio: { revision: 1, envelope: { ct: 'x' } } } as never;
  const out = encryptedBackupShare(pkg, new Date('2026-10-03T00:00:00Z'));
  assert.ok(out.ok);
  assert.equal(out.title, 'sipwise-encrypted-backup-2026-10-03.json');
  assert.equal(JSON.parse(out.text).kind, 'sipwise-encrypted-backup');
  assert.equal(encryptedBackupShare({ big: 'x'.repeat(BACKUP_SHARE_LIMIT_CHARS) } as never).ok, false);
});
