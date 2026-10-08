// Reads the "Statement of Account / Client Confirmation (under PSX Regulations 4.19)" PDF that PSX brokers issue
// from the same back-office software (Youngs Capital, Syed Faraz Equities, and others using that template).
// Pure: text in, a BrokerStatement out, reviewed in the broker import dialog. Only the confirmation fills are
// read; the ledger lines, bank details, address and name are ignored, so none of them reach the portfolio.
import type { BrokerHolding, BrokerStatement, BrokerTrade } from './broker-import.ts';
import { executionDateFromSettlement } from './psx-calendar.ts';

const fillPattern = new RegExp(
  `^\\s*([A-Z][A-Z0-9]{1,11})\\s+(\\d[\\d,]*)\\s+(\\d[\\d,]*\\.\\d+)((?:\\s+-?\\d[\\d,]*\\.\\d{2}){8})\\s+([A-Za-z]+)\\s*$`,
);

const money = (value: string) => Number(value.replace(/,/g, ''));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** True only for the confirmation template: all four fixed headings must be present. */
export function detectPsxConfirmation(text: string): boolean {
  return (
    /CLIENT\s+CONFIRMATION/i.test(text) &&
    /UNDER\s+PSX\s+REGULATIONS\s+4\.19/i.test(text) &&
    /STATEMENT\s+OF\s+ACCOUNT/i.test(text) &&
    /TREC\s+NO/i.test(text)
  );
}

/** "YOUNGS CAPITAL (PVT) LIMITED" -> "Youngs Capital". */
export function brokerNameOf(line: string): string {
  const cleaned = line
    .replace(/\(\s*(?:PVT|PRIVATE)\s*\)/gi, '')
    .replace(/\b(?:LIMITED|LTD\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).slice(0, 80);
}

export function parsePsxConfirmation(text: string): BrokerStatement {
  if (!detectPsxConfirmation(text)) throw Error('Choose a PSX broker Client Confirmation statement (PDF).');
  const lines = text.split(/\r?\n/);
  const nameLine = lines.find((l) => /\S/.test(l) && !/^---\s*PDF PAGE/.test(l));
  const broker = nameLine ? brokerNameOf(nameLine) : '';
  if (!broker) throw Error('The broker name could not be read from this statement.');

  const dateMatch = /Trade\s+Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i.exec(text);
  if (!dateMatch) throw Error('The statement is missing its Trade Date.');
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  // Client code only (e.g. "YC4453"); the name, NIC, address and bank account that follow it are never read.
  const account = /^\s*([A-Z]{1,5}\d{2,8})\s*-\s*\S/m.exec(text)?.[1] ?? '';

  const start = lines.findIndex((l) => /UNDER\s+PSX\s+REGULATIONS\s+4\.19/i.test(l));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*(?:Item-wise\s+)?Summary\s*$/i.test(l) || /^\s*Buy\s+Amount\s*:/i.test(l));
  const section = end === -1 ? rest : rest.slice(0, end);

  const trades: BrokerTrade[] = [];
  const warnings: string[] = [];
  let side: 'buy' | 'sell' | null = null;
  section.forEach((line, i) => {
    const heading = /^\s*(BUY|SELL)\s*$/.exec(line);
    if (heading) {
      side = heading[1] === 'BUY' ? 'buy' : 'sell';
      return;
    }
    if (/^\s*(Item|Buy|Sell|Client)\s+Total\b/i.test(line)) return;
    const fill = fillPattern.exec(line);
    if (!fill) {
      if (/^\s*[A-Z][A-Z0-9]{1,11}\s+\d[\d,]*\s+\d[\d,]*\.\d+\s/.test(line))
        throw Error(`A trade line in this statement could not be read: "${line.trim().slice(0, 60)}".`);
      return;
    }
    if (!side) throw Error('A trade line appears before its BUY or SELL heading.');
    const [, ticker, qty, rate, amounts, market] = fill;
    if (market.toLowerCase() !== 'ready')
      throw Error(`${ticker} is in the "${market}" market, which this import does not support. Only Ready (regular) trades are read.`);
    const figures = amounts.trim().split(/\s+/).map(money);
    const charges = figures.slice(0, 7);
    const net = figures[7];
    const shares = Number(qty.replace(/,/g, ''));
    const price = money(rate);
    const gross = r2(shares * price);
    // Fees are what separates the net amount from the gross value, so the ledger's cash matches the broker's.
    const fees = r2(side === 'buy' ? net - gross : gross - net);
    if (!Number.isSafeInteger(shares) || shares <= 0 || price <= 0 || fees < 0)
      throw Error(`The ${ticker} trade line has an invalid quantity, rate or net amount.`);
    if (Math.abs(r2(charges.reduce((a, b) => a + b, 0)) - fees) > 0.05)
      warnings.push(`${ticker} ${shares} @ ${price}: the listed charges do not add up to the net amount; the net amount was used.`);
    trades.push({ ticker, date, side, shares, price, fees, reference: null, line: start + 2 + i });
  });
  if (!trades.length) throw Error('No trades were found in this statement.');
  return { broker, account, report: 'trades', trades, holdings: [], warnings };
}

/**
 * The same back-office software's account ledger ("Statement of Account" with dated BUY/SELL narrations and an
 * "Inventory Position" table, no 4.19 confirmation section). Detected apart from the confirmation template.
 */
export function detectPsxLedger(text: string): boolean {
  return (
    /STATEMENT\s+OF\s+ACCOUNT/i.test(text) &&
    /TREC\s+NO/i.test(text) &&
    /INVENTORY\s+POSITION/i.test(text) &&
    /^\s*[A-Z]{2}\d{4,}\s+\d{2}-\d{2}-\d{2}\s+T\+\d\s+(?:BUY|SELL)\s+#/m.test(text)
  );
}

const ledgerTrade =
  /^\s*[A-Z]{2}\d{4,}\s+(\d{2})-(\d{2})-(\d{2})\s+T\+(\d)\s+(BUY|SELL)\s+#\s*\d+\s+([A-Z][A-Z0-9]{1,11})\s+(\d[\d,]*)\s+@\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d{2})\s+-\s+\d[\d,]*\.\d{2}\s+Cr(?:\s+(\d{2})-(\d{2})-(\d{2}))?\s*$/;
const inventoryRow =
  /^\s*([A-Z][A-Z0-9]{1,11})\s+\S.*?\s+(\d[\d,]*)\s+(\d[\d,]*)\s+\d[\d,]*\.\d+\s+-?\d[\d,]*\s+\d[\d,]*\.\d+\s+-?\d[\d,]*\s+-?\d[\d,]*\s*$/;

export function parsePsxLedger(text: string): BrokerStatement {
  if (!detectPsxLedger(text)) throw Error('Choose a PSX broker Statement of Account (PDF).');
  const lines = text.split(/\r?\n/);
  const nameLine = lines.find((l) => /\S/.test(l) && !/^---\s*PDF PAGE/.test(l));
  const broker = nameLine ? brokerNameOf(nameLine) : '';
  if (!broker) throw Error('The broker name could not be read from this statement.');
  const dateMatch = /Trade\s+Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i.exec(text);
  if (!dateMatch) throw Error('The statement is missing its Trade Date.');
  const asOf = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  const account = /^\s*([A-Z]{1,5}\d{2,8})\s*-\s*\S/m.exec(text)?.[1] ?? '';

  const trades: BrokerTrade[] = [];
  const holdings: BrokerHolding[] = [];
  const warnings: string[] = [];
  let inventory = false;
  lines.forEach((line, i) => {
    if (/^\s*INVENTORY\s+POSITION\s*$/i.test(line)) inventory = true;
    else if (/^\s*FLOATING\s+POSITION\s*$/i.test(line)) inventory = false;
    const t = ledgerTrade.exec(line);
    if (t) {
      const [, d, m, y, settle, sideWord, ticker, qty, rate, amount, td, tm, ty] = t;
      const side = sideWord === 'BUY' ? 'buy' : 'sell';
      const entry = `20${y}-${m}-${d}`;
      // The trailing date is the day the trade executed; otherwise walk back from the entry date.
      const date = td ? `20${ty}-${tm}-${td}` : executionDateFromSettlement(entry, Number(settle) === 2 ? 2 : 1).date;
      const shares = Number(qty.replace(/,/g, ''));
      const net = money(amount);
      let price = money(rate);
      const gross = r2(shares * price);
      let fees = r2(side === 'buy' ? net - gross : gross - net);
      if (fees < 0) {
        // The ledger rate is a rounded average, so the net amount can sit under shares x rate: keep cash exact.
        price = Math.round((net / shares) * 10000) / 10000;
        fees = 0;
      }
      if (!Number.isSafeInteger(shares) || shares <= 0 || !(price > 0)) throw Error(`The ${ticker} ledger line has an invalid quantity or rate.`);
      trades.push({ ticker, date, side, shares, price, fees, reference: null, line: i + 1 });
      return;
    }
    if (/^\s*[A-Z]{2}\d{4,}\s+\d{2}-\d{2}-\d{2}\s+T\+\d\s+(?:BUY|SELL)\b/.test(line))
      throw Error(`A trade line in this statement could not be read: "${line.trim().slice(0, 60)}".`);
    if (inventory) {
      const h = inventoryRow.exec(line);
      if (h) holdings.push({ ticker: h[1], asOf, shares: Number(h[3].replace(/,/g, '')), line: i + 1 });
    }
  });
  if (!trades.length && !holdings.length) throw Error('No trades were found in this statement.');
  if (holdings.length)
    warnings.push('Holdings are the broker’s inventory on the statement date; shares not explained by the listed trades are offered as balance adjustments.');
  return { broker, account, report: trades.length && holdings.length ? 'both' : trades.length ? 'trades' : 'holdings', trades, holdings, warnings };
}
