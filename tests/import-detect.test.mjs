import test from 'node:test';
import assert from 'node:assert/strict';
import { detectJsonImport, detectPdfImport, summarizeImports } from '../lib/import-detect.ts';

test('PDFs: Finqalab by title, anything else goes to the AHL parser', () => {
  assert.equal(detectPdfImport('Periodic Trade Details Report By Finqalab\nTotal Records: 1'), 'finqalab');
  assert.equal(detectPdfImport('Client Ledger'), 'ahl');
});

test('JSON files are told apart by their fields', () => {
  assert.equal(detectJsonImport({ data: [{ subscriptionAppId: '1', securitySymbol: 'AAA' }] }), 'ipo');
  assert.equal(detectJsonImport({ data: [{ securitySymbol: 'AAA', dividendStatus: 'PAID', grossDividendAmount: '1' }] }), 'cdc');
  assert.equal(detectJsonImport([{ scrip: 'AAA', grossRate: 1, quantity: 1 }]), 'ahl');
  assert.equal(detectJsonImport({ hello: 1 }), null);
  assert.equal(detectJsonImport([]), null);
});

test('summary counts only live rows from each source', () => {
  const s = summarizeImports({
    trades: [{ source: 'ahl', date: '2026-01-02' }, { source: 'ahl', date: '2026-03-04' }, { source: 'ahl', date: '2026-09-09', voided: true }, { source: 'ipo', date: '2026-05-05' }, { date: '2026-06-06' }],
    dividends: [{ source: 'import', date: '2026-02-02' }, { source: 'manual', date: '2026-02-03' }],
  });
  assert.deepEqual(s.ahl, { count: 2, latest: '2026-03-04' });
  assert.deepEqual(s.ipo, { count: 1, latest: '2026-05-05' });
  assert.deepEqual(s.cdc, { count: 1, latest: '2026-02-02' });
  assert.equal(s.finqalab, null);
});
