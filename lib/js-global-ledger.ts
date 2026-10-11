// Reads the "Statement Of Account" PDF from JS Global Capital Limited: a dated ledger of
// "T+2 BUY # 4694 MIIETF 500 @ 25.1234" narrations (the debit/credit is the net amount, so fees are the
// difference from shares x rate) followed by an "Inventory Position" table. Pure: text in, a BrokerStatement
// out, reviewed in the broker import dialog. Only the broker name, client code, trades and holdings are read;
// the client's name, CDC id, CNIC, address and phone are never copied into the result.
import type { BrokerHolding, BrokerStatement, BrokerTrade } from './broker-import.ts';
import { executionDateFromSettlement } from './psx-calendar.ts';

const money = (value: string) => Number(value.replace(/,/g, ''));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = String.raw`\d[\d,]*(?:\.\d+)?`;

const tradeLine = new RegExp(
  String.raw`^\s*[A-Z]{2}\d{4,}\s+(\d{2})-(\d{2})-(\d{2})\s+T\+(\d)\s+(BUY|SELL)\s+#\s*\d+\s+([A-Z][A-Z0-9]{1,11})\s+(\d[\d,]*)\s*@\s*(?:(${num})\s+)?(${num})(?:\s+-)?\s+-?${num}(?:\s*(?:Cr|Dr))?(?:\s+(\d{2})-(\d{2})-(\d{2}))?\s*$`,
);
const anyTrade = /^\s*[A-Z]{2}\d{4,}\s+\d{2}-\d{2}-\d{2}\s+T\+\d\s+(?:BUY|SELL)\b/;
const differenceLine = /^\s*[A-Z]{2}\d{4,}\s+\d{2}-\d{2}-\d{2}\s+T\+\d\s+Difference\b/;
// Symbol, name, then the quantity per back office followed by three or four more figures (pledge may be blank).
const inventoryRow = new RegExp(String.raw`^\s*([A-Z][A-Z0-9]{1,11})\s+[^\d]+?\s+(\d[\d,]*)(?:\s+-?\d[\d,]*){3,4}\s*$`);

export function detectJsGlobalLedger(text: string): boolean {
  return (
    /JS\s+GLOBAL\s+CAPITAL/i.test(text) &&
    /STATEMENT\s+OF\s+ACCOUNT/i.test(text) &&
    /INVENTORY\s+POSITION/i.test(text) &&
    new RegExp(`^\\s*[A-Z]{2}\\d{4,}\\s+\\d{2}-\\d{2}-\\d{2}\\s+T\\+\\d\\s+(?:BUY|SELL)\\s+#`, 'm').test(text)
  );
}

/** "JS GLOBAL CAPITAL LIMITED" -> "JS Global Capital" (short words such as JS stay upper case). */
function brokerNameOf(text: string): string {
  const raw = /Page\s*:\s*\d+\s*\/\s*\d+\s+(.+?)\s+From\s+Date/i.exec(text)?.[1] ?? /(JS\s+GLOBAL\s+CAPITAL(?:\s+LIMITED)?)/i.exec(text)?.[1] ?? '';
  return raw
    .replace(/\(\s*(?:PVT|PRIVATE)\s*\)/gi, '')
    .replace(/\b(?:LIMITED|LTD\.?)\s*$/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .slice(0, 80);
}

export function parseJsGlobalLedger(text: string): BrokerStatement {
  if (!detectJsGlobalLedger(text)) throw Error('Choose a JS Global Capital Statement of Account (PDF).');
  const broker = brokerNameOf(text);
  if (!broker) throw Error('The broker name could not be read from this statement.');
  const asOfMatch = /As\s+On\s+(\d{2})-(\d{2})-(\d{4})/i.exec(text) ?? /To\s+Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i.exec(text);
  if (!asOfMatch) throw Error('The statement is missing its "As On" date.');
  const asOf = `${asOfMatch[3]}-${asOfMatch[2]}-${asOfMatch[1]}`;
  // Client code only (the number before the name); the name, CDC id, CNIC, address and phone are never read.
  const account = /^\s*(\d{4,10})\s+[A-Z]/m.exec(text)?.[1] ?? '';

  const lines = text.split(/\r?\n/);
  const trades: BrokerTrade[] = [];
  const holdings: BrokerHolding[] = [];
  const warnings: string[] = [];
  let inventory = false;
  let differences = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*Inventory\s+Position\s*$/i.test(line)) inventory = true;
    if (differenceLine.test(line)) {
      differences++;
      continue;
    }
    if (anyTrade.test(line)) {
      let t = tradeLine.exec(line);
      // A long narration wraps, leaving the rate alone on the next line.
      if (t && t[8] === undefined) {
        const next = /^\s*(\d[\d,]*(?:\.\d+)?)\s*$/.exec(lines[i + 1] ?? '');
        if (!next) t = null;
        else t = tradeLine.exec(line.replace(/@\s*/, `@ ${next[1]} `)) ?? null;
      }
      if (!t) throw Error(`A trade line in this statement could not be read: "${line.trim().slice(0, 60)}".`);
      const [, d, m, y, settle, sideWord, ticker, qty, rate, amount, td, tm, ty] = t;
      const side = sideWord === 'BUY' ? 'buy' : 'sell';
      const entry = `20${y}-${m}-${d}`;
      // The cheque date is the day the trade executed; otherwise walk back from the entry date.
      const date = td ? `20${ty}-${tm}-${td}` : executionDateFromSettlement(entry, Number(settle) === 2 ? 2 : 1).date;
      const shares = Number(qty.replace(/,/g, ''));
      const net = money(amount);
      let price = money(rate);
      let fees = r2(side === 'buy' ? net - r2(shares * price) : r2(shares * price) - net);
      if (fees < 0) {
        // The ledger rate can be rounded, so the net amount may sit under shares x rate: keep cash exact.
        price = Math.round((net / shares) * 10000) / 10000;
        fees = 0;
      }
      if (!Number.isSafeInteger(shares) || shares <= 0 || !(price > 0)) throw Error(`The ${ticker} ledger line has an invalid quantity or rate.`);
      trades.push({ ticker, date, side, shares, price, fees, reference: null, line: i + 1 });
      continue;
    }
    if (inventory) {
      const h = inventoryRow.exec(line);
      if (h) holdings.push({ ticker: h[1], asOf, shares: Number(h[2].replace(/,/g, '')), line: i + 1 });
      else if (/^\s*[A-Z][A-Z0-9]{1,11}\s+\S.*\d\s*$/.test(line) && !/^\s*(?:Total|As\s+On|Item)\b/i.test(line))
        warnings.push(`An inventory line could not be read and was skipped: "${line.trim().slice(0, 40)}".`);
    }
  }
  if (!trades.length && !holdings.length) throw Error('No trades were found in this statement.');
  if (differences)
    warnings.push(`${differences} small price-difference adjustment${differences === 1 ? '' : 's'} in the ledger ${differences === 1 ? 'was' : 'were'} skipped: they move no shares.`);
  if (holdings.length)
    warnings.push('Holdings are the broker’s inventory on the statement date; shares not explained by the listed trades are offered as balance adjustments.');
  return { broker, account, report: trades.length && holdings.length ? 'both' : trades.length ? 'trades' : 'holdings', trades, holdings, warnings };
}
