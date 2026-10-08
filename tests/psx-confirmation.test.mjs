import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectPsxConfirmation, parsePsxConfirmation, detectPsxLedger, parsePsxLedger } from '../lib/psx-confirmation.ts';
import { planBrokerImport, applyBrokerImport, validateBrokerStatement } from '../lib/broker-import.ts';
import { detectPdfImport } from '../lib/import-detect.ts';

// Invented statements: fictional broker, client "TC0001-TEST CLIENT", no real names, accounts or addresses.
const header = (broker, trec) => `${broker} (PVT) LIMITED
TREC HOLDER: PAKISTAN STOCK EXCHANGE LIMITED.
TREC NO: ${trec}
Trade Date :13-02-2026              Settlement Date : 16-02-2026

TC0001-TEST CLIENT                                  CDC ID : 000000
Address : Nowhere Street

NIC/PP/REG 0000000000000
Bank A/c. # PK00TEST0000000000000000 TEST CLIENT

STATEMENT OF ACCOUNT
Entry #  Date  Narration  Debit  Credit  Balance
CV000001 16-02-26 T+1 BUY # 100001 AAA 440 @ 217.43   95,667.99    - 432.56 Cr
`;
const body = `CLIENT CONFIRMATION
UNDER PSX REGULATIONS 4.19
Scrip   Quantity  Rate  Comm. Amt.  CDC Charges  PSX Laga  Secp Laga  NCCPL  Others  SST / PST  Net Amount  Market

BUY
ALPHA FERTILIZER LIMITED
AAA                      40    216.2000                12.97          0.45            0.36        0.06            0.28             0.00              2.18           8,664.30 Ready
AAA                     200    216.7000                65.02          2.27            1.81        0.28            1.40             0.00             10.93          43,421.70 Ready
AAA                     200    216.7000                65.02          2.27            1.81        0.28            1.40             0.00             10.93          43,421.70 Ready

Item Total               440                        143.25             5.00            3.98        0.62            3.07             0.00             24.07          95,668.00

BETA POWER LIMITED
BBB                      100    222.2500                33.34          2.27            0.93        0.14            0.72             0.00              5.60          22,268.00 Ready

SELL
CCC                       10    100.0000                 1.50          0.05            0.04        0.01            0.03             0.00              0.25             998.12 Ready

Buy Total                660                        216.47            10.00            6.02        0.94            4.65             0.00             36.38        144,567.44
Client Total             660

Summary
Buy Amount :              144,567.44                Sell Amount :        998.12
Item-wise Summary
AAA   440  0  440  217.0182  95,488.00  143.25  24.07  7.68  5.00  95,668.00
`;
const statement = (broker = 'SAMPLE BROKER') => header(broker, '999') + body;

test('recognises the confirmation template and routes nothing else to it', () => {
  assert.equal(detectPsxConfirmation(statement()), true);
  assert.equal(detectPsxConfirmation('Arif Habib Limited Client Ledger'), false);
  assert.equal(detectPdfImport(statement()), null, 'handled by its own reader, not the AHL/Finqalab ones');
  assert.throws(() => parsePsxConfirmation('Periodic Trade Details Report By Finqalab'));
});

test('reads every fill with fees taken from the net amount, buys and sells', () => {
  const s = parsePsxConfirmation(statement('YOUNGS CAPITAL'));
  assert.equal(s.broker, 'Youngs Capital');
  assert.equal(s.account, 'TC0001');
  assert.equal(s.report, 'trades');
  assert.equal(s.trades.length, 5);
  assert.deepEqual(
    s.trades.map(({ ticker, date, side, shares, price, fees }) => ({ ticker, date, side, shares, price, fees })),
    [
      { ticker: 'AAA', date: '2026-02-13', side: 'buy', shares: 40, price: 216.2, fees: 16.3 },
      { ticker: 'AAA', date: '2026-02-13', side: 'buy', shares: 200, price: 216.7, fees: 81.7 },
      { ticker: 'AAA', date: '2026-02-13', side: 'buy', shares: 200, price: 216.7, fees: 81.7 },
      { ticker: 'BBB', date: '2026-02-13', side: 'buy', shares: 100, price: 222.25, fees: 43.0 },
      { ticker: 'CCC', date: '2026-02-13', side: 'sell', shares: 10, price: 100, fees: 1.88 },
    ],
  );
  assert.equal(parsePsxConfirmation(statement('SYED FARAZ EQUITIES')).broker, 'Syed Faraz Equities');
  assert.equal(validateBrokerStatement(s).trades.length, 5);
});

test('no personal details reach the result', () => {
  const json = JSON.stringify(parsePsxConfirmation(statement()));
  for (const secret of ['TEST CLIENT', 'Nowhere', 'PK00TEST', '000000']) assert.ok(!json.includes(secret), secret);
});

test('rejects unsupported markets and unreadable lines instead of dropping them', () => {
  assert.throws(() => parsePsxConfirmation(statement().replace('8,664.30 Ready', '8,664.30 Future')), /Future/);
  assert.throws(() => parsePsxConfirmation(statement().replace('0.00              2.18', '0.00')), /could not be read/);
});

test('import dedupes identical fills by order, and re-import changes nothing', () => {
  const portfolio = {
    companies: [{ ticker: 'CCC', name: 'Gamma', sector: '', target: 0, approved: false, screenDate: '', note: '' }],
    trades: [{ id: 'old', ticker: 'CCC', kind: 'buy', date: '2026-01-05', shares: 10, price: 90, fees: 0, month: '2026-01', note: '' }],
    quotes: {}, budgets: {},
  };
  const s = parsePsxConfirmation(statement());
  const plan = planBrokerImport(portfolio, s);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.rows.filter((r) => r.action === 'import').length, 5, 'the two identical 200 @ 216.7 fills both import');
  const next = applyBrokerImport(portfolio, s, plan);
  assert.equal(next.trades.length, 6);
  assert.ok(next.trades.filter((t) => t.id !== 'old').every((t) => t.source === 'broker' && t.accountId === 'SAMPLE BROKER:TC0001'));
  const again = planBrokerImport(next, s);
  assert.equal(again.rows.filter((r) => r.action === 'import').length, 0);
  assert.ok(again.rows.every((r) => r.status === 'duplicate'));
});

// Real statements are never committed; point these at local files to check the live layout.
for (const [env, broker, trades] of [['YOUNGS_LOCAL_PDF', 'Youngs Capital', 1], ['SFEL_LOCAL_PDF', 'Syed Faraz Equities', 5]]) {
  test(`real ${broker} statement (local only)`, { skip: !process.env[env] }, async () => {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const { extractMarkedText } = await import('../lib/pdf-layout.mjs');
    const root = createRequire(import.meta.url).resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
    const pdfjs = await import(pathToFileURL(root + 'legacy/build/pdf.mjs').href);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.env[env])), verbosity: 0 }).promise;
    const s = parsePsxConfirmation(await extractMarkedText(doc));
    assert.equal(s.broker, broker);
    assert.equal(s.trades.length, trades);
    assert.deepEqual(s.warnings, []);
  });
}

// Invented account ledger: no real names, accounts or addresses.
const ledger = `
--- PDF PAGE 1 ---
TEST BROKER (PVT) LIMITED
TREC NO: 1
Trade Date :08-10-2026 Settlement Date : 09-10-2026
TC0001-TEST CLIENT CDC ID : 000000
STATEMENT OF ACCOUNT
Entry # Date Narration Debit Credit Balance Cheque # Chq. Dt
CV070001 02-07-26 T+1 BUY # 217 AAA 10 @ 305.11 3,051.08 - 157,873.75 Cr 01-07-26
CV070100 29-07-26 T+1 SELL # 14496 AAA 5 @ 296.36 1,481.58 - 21,836.19 Cr 28-07-26
GV070203 30-07-26 ESL ACCOUNT MAINTENANCE JULY 2026 96.66 - 21,739.53 Cr
INVENTORY POSITION
Item Name Unsettled Qty Net Quantity Avg. Rate Amount Closing Market Value M2M Profit/Loss
AAA ALPHA TEST COMPANY LIM 0 5 305.11 1,526 320.00 1,600 74
FLOATING POSITION
`;
test('account ledger: trades and inventory, rounded-rate buys keep the net cash', () => {
  assert.equal(detectPsxConfirmation(ledger), false);
  assert.equal(detectPsxLedger(ledger), true);
  const s = parsePsxLedger(ledger);
  assert.equal(s.report, 'both');
  assert.deepEqual(s.trades.map((t) => [t.date, t.side, t.shares, t.fees]), [['2026-07-01', 'buy', 10, 0], ['2026-07-28', 'sell', 5, 0.22]]);
  assert.equal(s.trades[0].price * 10, 3051.08);
  assert.deepEqual(s.holdings.map((h) => [h.ticker, h.shares, h.asOf]), [['AAA', 5, '2026-10-08']]);
});

test('account ledger: debit balances (Dr) and price-difference lines', () => {
  const text = ledger.replace('INVENTORY POSITION', `CV020096 27-02-26 T+1 BUY # 170040 AAA 200 @ 614.09 122,817.64 37,865.00 Dr 26-02-26
CV020066 20-02-26 T+1 Difference # 28585 AAA 30 @ 1.21 36.20 - 238,459.94 Cr 19-02-26
INVENTORY POSITION`);
  const s = parsePsxLedger(text);
  assert.equal(s.trades.length, 3);
  assert.equal(s.trades[2].shares, 200);
  assert.ok(s.warnings.some((w) => /price-difference/.test(w)));
});
