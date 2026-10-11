import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectJsGlobalLedger, parseJsGlobalLedger } from '../lib/js-global-ledger.ts';
import { detectPsxConfirmation, detectPsxLedger } from '../lib/psx-confirmation.ts';
import { detectPdfImport } from '../lib/import-detect.ts';
import { planBrokerImport, applyBrokerImport, validateBrokerStatement } from '../lib/broker-import.ts';

// Invented statement in the layout JS Global Capital issues: no real name, CDC id, CNIC, address or phone.
const statement = `--- PDF PAGE 1 ---
Page : 1 / 1 JS GLOBAL CAPITAL LIMITED From Date : 01-01-2026
Date : 04-05-2026 Statement Of Account To Date : 31-03-2026
Time : 10:59:23
000123 TEST CLIENT CDC Id: 00000-000000
Address : NOWHERE STREET Tel: C.N.I.C: 00000-0000000-0
,03000000000
Entry # Date Narration Debit Credit Balance Cheque # Chq. Dt Effect
0V000001 01-01-26 Balance B/F.... 5,000.00 - 5,000.00
CV010003 02-01-26 T+2 BUY # 4694 AAA 100 @ 50.5000 5,060.00 - 10,060.00 31-12-25
CV010003 02-01-26 T+2 BUY # 4694 LONGETF 1,000@ 12,512.00 - 22,572.00 31-12-25
12.5000
CV010031 07-01-26 T+2 BUY # 18421 BBB 20 @ 100.25 2,009.00 - 13,081.00 05-01-26
GV010142 16-01-26 CDC CUSTODY CHARGES - DEC - 0.38 - 13,081.38
2025
CV010155 23-01-26 T+2 SELL # 78308 AAA 40 @ 52.0000 2,070.00 - 11,011.38 21-01-26
CV010156 23-01-26 T+2 Difference # 78309 AAA 40 @ 0.10 4.00 - 11,015.38 21-01-26
JV030087 17-03-26 MARKUP FOR THE HALF YEAR 111.00 - 11,126.38 17-03-26
ENDED DEC 31, 2025
Total: 9,999.00 9,999.00 11,126.38 Cr
Inventory Position
As On 31-03-2026
Item Symbol Item Name Qty. as Per Back Office Pledge Qty. Available Qty. CDC Position Difference CDC
AAA ALPHA TEST COMPANY LIMITED 60 60 60 0
BBB BETA TEST LTD. 20 20 20 0
LONGETF LONG TEST EXCHANGE TRADED F 1,000 1,000 1,000 0
Total : 1,080 1,080 1,080 0
*There is no reconciling item.
User : TEST
`;

test('detects the JS Global statement and nothing else claims it', () => {
  assert.equal(detectJsGlobalLedger(statement), true);
  assert.equal(detectPsxConfirmation(statement), false);
  assert.equal(detectPsxLedger(statement), false);
  assert.equal(detectPdfImport(statement), null);
  assert.equal(detectJsGlobalLedger(statement.replace('JS GLOBAL CAPITAL', 'OTHER BROKER')), false);
  assert.throws(() => parseJsGlobalLedger('Arif Habib Limited Client Ledger'));
});

test('reads trades with fees from the net amount, a wrapped rate, and the inventory', () => {
  const s = parseJsGlobalLedger(statement);
  assert.equal(s.broker, 'JS Global Capital');
  assert.equal(s.account, '000123');
  assert.equal(s.report, 'both');
  assert.deepEqual(
    s.trades.map(({ ticker, date, side, shares, price, fees }) => ({ ticker, date, side, shares, price, fees })),
    [
      { ticker: 'AAA', date: '2025-12-31', side: 'buy', shares: 100, price: 50.5, fees: 10 },
      { ticker: 'LONGETF', date: '2025-12-31', side: 'buy', shares: 1000, price: 12.5, fees: 12 },
      { ticker: 'BBB', date: '2026-01-05', side: 'buy', shares: 20, price: 100.25, fees: 4 },
      { ticker: 'AAA', date: '2026-01-21', side: 'sell', shares: 40, price: 52, fees: 10 },
    ],
  );
  assert.deepEqual(s.holdings.map((h) => [h.ticker, h.shares, h.asOf]), [['AAA', 60, '2026-03-31'], ['BBB', 20, '2026-03-31'], ['LONGETF', 1000, '2026-03-31']]);
  assert.ok(s.warnings.some((w) => /price-difference/.test(w)));
  assert.equal(validateBrokerStatement(s).trades.length, 4);
});

test('no personal details reach the result', () => {
  const json = JSON.stringify(parseJsGlobalLedger(statement));
  for (const secret of ['TEST CLIENT', 'NOWHERE', '00000-000000', '03000000000']) assert.ok(!json.includes(secret), secret);
});

test('an unreadable trade line is rejected, not dropped', () => {
  assert.throws(() => parseJsGlobalLedger(statement.replace('12.5000\n', '')), /could not be read/);
  assert.throws(() => parseJsGlobalLedger(statement.replace('5,060.00 -', 'oops -')), /could not be read/);
});

test('import dedupes by order, and re-import changes nothing', () => {
  const portfolio = { companies: [], trades: [], quotes: {}, budgets: {} };
  const s = parseJsGlobalLedger(statement);
  const plan = planBrokerImport(portfolio, s);
  assert.equal(plan.rows.filter((r) => r.action === 'import').length, 4);
  const withActions = Object.fromEntries(plan.adjustments.map((a) => [a.key, 'import']));
  const plan2 = planBrokerImport(portfolio, s, withActions);
  assert.deepEqual(plan2.blockers, []);
  const next = applyBrokerImport(portfolio, s, plan2);
  assert.ok(next.trades.every((t) => t.source === 'broker' && t.accountId === 'JS GLOBAL CAPITAL:000123'));
  const again = planBrokerImport(next, s);
  assert.equal(again.rows.filter((r) => r.action === 'import').length, 0);
});

// Real statements are never committed; point JS_LOCAL_PDF at a local file to check the live layout.
test('real JS Global statement (local only)', { skip: !process.env.JS_LOCAL_PDF }, async () => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { extractMarkedText } = await import('../lib/pdf-layout.mjs');
  const root = createRequire(import.meta.url).resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
  const pdfjs = await import(pathToFileURL(root + 'legacy/build/pdf.mjs').href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.env.JS_LOCAL_PDF)), verbosity: 0 }).promise;
  const s = parseJsGlobalLedger(await extractMarkedText(doc));
  assert.equal(s.broker, 'JS Global Capital');
  assert.equal(s.trades.length, 16);
  assert.equal(s.holdings.length, 13);
});
