import { unzipSync, strFromU8 } from 'fflate';
import { validateBrokerStatement, type BrokerFormat, type BrokerStatement, type BrokerTrade, type BrokerHolding } from './broker-import.ts';

export type BrokerTable = { headers: string[]; rows: string[][]; text: string; signature: string };
/** Remove obvious personal identifiers while leaving transaction amounts and references readable. */
export function redactBrokerText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[CNIC removed]')
    .replace(/\b(?:\+92|0)3\d{2}[ -]?\d{7}\b/g, '[phone removed]')
    .replace(/\b((?:account|client)\s*(?:number|no\.?|id|code)\s*[:#-]?\s*)[A-Z0-9-]{6,}/gi, '$1[account removed]');
}
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (c === ',' && !quote) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function xlsxRows(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const decode = (path: string) => files[path] ? strFromU8(files[path]) : '';
  const sharedDoc = new DOMParser().parseFromString(decode('xl/sharedStrings.xml'), 'application/xml');
  const shared = Array.from(sharedDoc.getElementsByTagName('si'), (item) => item.textContent ?? '');
  const sheet = decode('xl/worksheets/sheet1.xml');
  if (!sheet) throw Error('The Excel workbook has no readable first sheet.');
  const xml = new DOMParser().parseFromString(sheet, 'application/xml');
  return [...xml.getElementsByTagName('row')].map((r) => {
    const cells: string[] = [];
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') ?? '';
      const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
      let index = 0; for (const ch of letters) index = index * 26 + ch.charCodeAt(0) - 64;
      const raw = c.getElementsByTagName('v')[0]?.textContent ?? c.getElementsByTagName('is')[0]?.textContent ?? '';
      cells[index - 1] = c.getAttribute('t') === 's' ? shared[Number(raw)] ?? '' : raw;
    }
    return Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
  }).filter((r) => r.some(Boolean));
}
export async function readBrokerTable(file: File): Promise<BrokerTable> {
  const lower = file.name.toLowerCase();
  const rows = lower.endsWith('.csv') ? csvRows(await file.text()) : lower.endsWith('.xlsx') ? xlsxRows(new Uint8Array(await file.arrayBuffer())) : [];
  if (!rows.length || !rows[0]?.length) throw Error('No table rows were found.');
  const headers = rows[0].map((h) => h.trim());
  const body = rows.slice(1);
  const signature = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
  return { headers, rows: body, signature, text: [headers, ...body].map((r, i) => `Line ${i + 1}: ${r.join(' | ')}`).join('\n') };
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const numeric = (value: string) => Number(value.replace(/,/g, '').trim());
function toIso(value: string, style: 'iso' | 'dmy') {
  if (style === 'iso') return value.trim();
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : value.trim();
}
export function formatFromReviewed(table: BrokerTable, statement: BrokerStatement): BrokerFormat | null {
  if (statement.trades.length && statement.holdings.length) return null;
  const first: BrokerTrade | BrokerHolding | undefined = statement.trades.length ? statement.trades[0] : statement.holdings[0];
  if (!first) return null;
  const row = table.rows[first.line - 2];
  if (!row) return null;
  const index = (value: string) => row.findIndex((v) => same(v, value));
  const numberIndex = (value: number) => row.findIndex((v) => v.trim() !== '' && numeric(v) === value);
  const date = 'date' in first ? first.date : first.asOf;
  const dateStyle = row.some((v) => same(v, date)) ? 'iso' : 'dmy';
  const trade = 'side' in first ? first : null;
  const columns = {
    ticker: index(first.ticker), date: row.findIndex((v) => toIso(v, dateStyle) === date), side: trade ? index(trade.side) : null, shares: numberIndex(first.shares),
    price: trade ? numberIndex(trade.price) : null, fees: trade ? numberIndex(trade.fees) : null, reference: trade?.reference ? index(trade.reference) : null,
  };
  if (Object.values(columns).some((n) => n === -1)) return null;
  if (new Set(Object.values(columns).filter((n) => n !== null)).size !== Object.values(columns).filter((n) => n !== null).length) return null;
  return { broker: statement.broker, signature: table.signature, report: trade ? 'trades' : 'holdings', dateStyle, columns };
}
export function parseSavedFormat(table: BrokerTable, format: BrokerFormat): BrokerStatement {
  if (table.signature !== format.signature) throw Error('Statement layout changed.');
  const c = format.columns;
  const field = (r: string[], col: number | null) => col === null ? '' : r[col] ?? '';
  const trades: BrokerTrade[] = [];
  const holdings: BrokerHolding[] = [];
  for (const [i, row] of table.rows.entries()) {
    const ticker = field(row, c.ticker);
    if (format.report === 'holdings') {
      if (ticker) holdings.push({ ticker, asOf: toIso(field(row, c.date), format.dateStyle), shares: numeric(field(row, c.shares)), line: i + 2 });
      continue;
    }
    const side = field(row, c.side).toLowerCase();
    if (!ticker || !side) continue;
    if (side !== 'buy' && side !== 'sell') throw Error(`Unexpected side in line ${i + 2}.`);
    trades.push({ ticker, date: toIso(field(row, c.date), format.dateStyle), side, shares: numeric(field(row, c.shares)), price: numeric(field(row, c.price)), fees: numeric(field(row, c.fees)), reference: field(row, c.reference) || null, line: i + 2 });
  }
  if (!trades.length && !holdings.length) throw Error('No rows matched the saved format.');
  return validateBrokerStatement({ broker: format.broker, account: '', report: format.report, trades, holdings, warnings: [] });
}
