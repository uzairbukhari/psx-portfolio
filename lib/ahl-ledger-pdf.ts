// Deterministic parser for the Arif Habib Limited "Client Ledger" PDF, working on the page-marked text
// that app/research-pdf.ts (pdf.js + lib/pdf-layout.mjs) produces in the browser. Nothing is uploaded.
//
// Contract (see docs/ahl-import-dividend-sync-progress.md):
//  - every ledger row is read, its running balance checked against the previous one, and the closing
//    totals checked against the printed footer; any gap, malformed row or missing page throws, so a
//    failed parse can never produce a partial import;
//  - only buys and sells become trades. Deposits, withdrawals, interest, account charges and standalone
//    tax deductions are counted and shown as excluded;
//  - the voucher date printed on a trade row is the SETTLEMENT date. The execution date is recovered with
//    the printed T+n marker and the PSX calendar, and flagged when that rests on unverified holidays;
//  - the unit rate printed on a row is fee-inclusive, so gross cash is rebuilt from net cash and the
//    disclosed components, and the unit price is snapped to a PSX tick only when that reproduces the
//    reported cash within currency rounding.
import { executionDateFromSettlement, SETTLEMENT_T1_FROM } from './psx-calendar.ts';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Cash on a statement is printed to 0.01; component fees to 0.0001. Everything is compared in whole paisa. */
export const CASH_TOLERANCE_PAISA = 1;
/** Largest gap between reported net cash and (shares × snapped price ± components): half a paisa of rounding plus component rounding. */
const SNAP_TOLERANCE = 0.0055;

export type LedgerCategory = 'trade' | 'deposit' | 'withdrawal' | 'interest' | 'charge' | 'tax' | 'other';
export type LedgerRow = {
  page: number;
  voucher: string;
  /** Voucher date as printed: the settlement date for a trade. */
  date: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
  category: LedgerCategory;
};
export type StatementTrade = {
  ticker: string;
  kind: 'buy' | 'sell';
  shares: number;
  /** Price per share before any fee. */
  price: number;
  /** True when `price` is the exact tick-snapped gross rate; false when it is the unrounded cash quotient. */
  priceSnapped: boolean;
  /** Total of the disclosed components, rounded to 4 places. */
  componentFees: number;
  /** Fees that make shares × price ± fees equal the reported net cash exactly. */
  fees: number;
  /** Reported net cash: paid for a buy, received for a sell. */
  netCash: number;
  voucher: string;
  settlementDate: string;
  settlement: 'T+1' | 'T+2';
  executionDate: string;
  dateCertainty: 'confirmed' | 'inferred';
  /** Rate exactly as printed (fee-inclusive), for display only. */
  printedRate: number;
  page: number;
  /** Stable key: account fingerprint, voucher and normalised row, plus multiplicity. */
  identity: string;
  statementRef: string;
};
export type ExcludedSummary = { category: Exclude<LedgerCategory, 'trade'>; count: number; debit: number; credit: number };
export type AhlLedgerStatement = {
  format: 'ahl-client-ledger';
  pages: number;
  from: string;
  to: string;
  generated: string;
  accountFingerprint: string;
  rows: LedgerRow[];
  trades: StatementTrade[];
  excluded: ExcludedSummary[];
  totals: { debit: number; credit: number; balance: number };
  warnings: string[];
};

const paisa = (n: number) => Math.round(n * 100);
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
const money = (text: string) => Number(text.replace(/,/g, ''));

function isoDate(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text.trim());
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

async function fingerprint(accountCode: string) {
  const bytes = new TextEncoder().encode(`psx-portfolio:ahl-ledger:${accountCode.trim().toUpperCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ROW_START = /^([A-Z]{2}) ?(\d{3,}) (\d{1,2}-[A-Za-z]{3}-\d{2}) (.+)$/;
const MONEY = String.raw`-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}`;
const AMOUNTS = new RegExp(String.raw`(?:^|\s)(${MONEY}) (${MONEY}) (${MONEY})(?=\s|$)`);
const TRADE = /^T\+([12]) (Buy|Sell) ([A-Z0-9]{2,12}) (\d+)@(\d+(?:\.\d+)?)\s*(.*)$/;
const FEE_LABELS = new Set(['COMM', 'SST', 'CDC', 'FED', 'CVT']);

function classify(voucher: string, narration: string, debit: number, credit: number): LedgerCategory {
  const text = narration.toUpperCase();
  if (/^T\+\d (BUY|SELL) /.test(text)) return 'trade';
  if (/PROFIT ON|MARK ?UP|INTEREST/.test(text)) return 'interest';
  if (/^CGT|\bCGT\b|WITHHOLD|\bWHT\b|ADVANCE TAX/.test(text)) return /FEE/.test(text) ? 'charge' : 'tax';
  if (/FEE|CHARGE|COMMISSION|CDC ACCESS|SUBSCRIPTION/.test(text)) return 'charge';
  if (/FUND TRANSFER|RECD|RECEIPT|DEPOSIT|CHQ|CHEQUE|IBFT|CASH/.test(text) || voucher.startsWith('RV'))
    return credit > 0 && debit === 0 ? 'deposit' : debit > 0 && credit === 0 ? 'withdrawal' : 'other';
  if (voucher.startsWith('PV') || /PAYMENT|WITHDRAW/.test(text)) return 'withdrawal';
  return 'other';
}

type Draft = { page: number; voucher: string; vch: string; first: string; tail: string[] };

export async function parseAhlLedgerText(text: string, expectedPages?: number): Promise<AhlLedgerStatement> {
  if (!/Arif\s+Habib\s+Limited/i.test(text) || !/Client\s+Ledger/i.test(text))
    throw Error('This is not an Arif Habib Limited Client Ledger PDF.');
  const parts = text.split(/\n?--- PDF PAGE (\d+) ---\n/);
  const pageTexts: { n: number; body: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) pageTexts.push({ n: Number(parts[i]), body: parts[i + 1] });
  if (!pageTexts.length) {
    throw Error(
      'No readable text was found. The PDF may be a scanned image; export the ledger from the broker portal as a text PDF.',
    );
  }
  pageTexts.forEach((page, index) => {
    if (page.n !== index + 1) throw Error(`PDF page ${index + 1} is missing or out of order.`);
  });
  if (expectedPages !== undefined && expectedPages !== pageTexts.length)
    throw Error('The PDF text does not cover every page.');

  let from = '', to = '', generated = '', accountCode = '';
  const drafts: Draft[] = [];
  let totals: { debit: number; credit: number; balance: number } | null = null;
  let totalsPage = 0;
  for (const page of pageTexts) {
    const lines = page.body.split('\n').map((line) => line.replace(/\s+$/, '')).filter(Boolean);
    const headerAt = lines.findIndex((line) => /^Voucher#\s+Vch\.?\s+Date\s+Narration/i.test(line));
    if (headerAt < 0) throw Error(`PDF page ${page.n} has no ledger column header; it is not a supported Client Ledger layout.`);
    const head = lines.slice(0, headerAt).join('\n');
    if (!/Arif\s+Habib\s+Limited/i.test(head) || !/Client\s+Ledger/i.test(head))
      throw Error(`PDF page ${page.n} does not carry the Arif Habib Client Ledger heading.`);
    const f = /From\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(head)?.[1];
    const t = /To\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(head)?.[1];
    const g = /\b([A-Z]{2}\d{3,})\s+Date\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(head);
    if (!f || !t || !g) throw Error(`PDF page ${page.n} is missing its date range or generation date.`);
    const [pf, pt, pg] = [isoDate(f), isoDate(t), isoDate(g[2])];
    if (!pf || !pt || !pg) throw Error(`PDF page ${page.n} has an unreadable date in its heading.`);
    if (page.n === 1) [from, to, generated, accountCode] = [pf, pt, pg, g[1]];
    else if (pf !== from || pt !== to || g[1] !== accountCode)
      throw Error(`PDF page ${page.n} belongs to a different statement than page 1.`);
    let current: Draft | null = null;
    let sawFooter = false;
    for (const line of lines.slice(headerAt + 1)) {
      if (line.startsWith('©')) {
        const footer = /Page\s*:\s*(\d+)\s*$/.exec(line);
        if (!footer || Number(footer[1]) !== page.n) throw Error(`PDF page ${page.n} footer does not match its page number.`);
        sawFooter = true;
        continue;
      }
      if (sawFooter) throw Error(`PDF page ${page.n} has content after its footer.`);
      const total = new RegExp(String.raw`^(${MONEY}) (${MONEY}) (${MONEY})$`).exec(line);
      const start = ROW_START.exec(line);
      if (total && !start) {
        if (totals) throw Error('The statement has more than one totals line.');
        totals = { debit: money(total[1]), credit: money(total[2]), balance: money(total[3]) };
        totalsPage = page.n;
        current = null;
        continue;
      }
      if (start) {
        if (totals) throw Error('Ledger rows continue after the totals line.');
        current = { page: page.n, voucher: `${start[1]}${start[2]}`, vch: start[3], first: start[4], tail: [] };
        drafts.push(current);
      } else if (current) current.tail.push(line);
      else throw Error(`PDF page ${page.n} has text outside any ledger row: "${line.slice(0, 40)}".`);
    }
    if (!sawFooter) throw Error(`PDF page ${page.n} is incomplete (no footer).`);
  }
  if (!drafts.length) throw Error('The ledger has no rows.');
  if (!totals) throw Error('The ledger is incomplete: the closing totals line is missing (a page may be cut off).');
  if (totalsPage !== pageTexts.length) throw Error('The closing totals are not on the last page.');

  const fingerprintValue = await fingerprint(accountCode);
  const rows: LedgerRow[] = [];
  const trades: StatementTrade[] = [];
  const warnings: string[] = [];
  const multiplicity = new Map<string, number>();
  let running = 0; // paisa, balance = debit − credit accumulated
  for (const [index, draft] of drafts.entries()) {
    const label = `Ledger row ${index + 1} (page ${draft.page}, ${draft.voucher})`;
    const amounts = AMOUNTS.exec(draft.first);
    if (!amounts) throw Error(`${label}: could not read its debit, credit and balance columns.`);
    const debit = money(amounts[1]), credit = money(amounts[2]), balance = money(amounts[3]);
    const narrationHead = draft.first.slice(0, amounts.index).trim();
    const narration = [narrationHead, ...draft.tail].join(' ').replace(/\s+/g, ' ').trim();
    const date = isoDate(draft.vch);
    if (!date) throw Error(`${label}: unreadable date "${draft.vch}".`);
    if (date < from || date > to) throw Error(`${label}: dated ${date}, outside the statement range ${from} to ${to}.`);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw Error(`${label}: invalid debit/credit amounts.`);
    running += paisa(debit) - paisa(credit);
    if (Math.abs(running - paisa(balance)) > CASH_TOLERANCE_PAISA)
      throw Error(`${label}: running balance ${balance.toFixed(2)} does not follow from the previous row. A row or page may be missing.`);
    running = paisa(balance); // re-anchor so one rounding cent cannot accumulate
    const category = classify(draft.voucher, narration, debit, credit);
    rows.push({ page: draft.page, voucher: draft.voucher, date, narration, debit, credit, balance, category });
    if (category !== 'trade') continue;

    const m = TRADE.exec(narrationHead + (draft.tail.length ? ' ' + draft.tail.join(' ') : ''));
    if (!m) throw Error(`${label}: trade narration not understood.`);
    const [, tPlus, side, ticker, qty, printedRate, feeText] = m;
    const shares = Number(qty);
    if (!Number.isSafeInteger(shares) || shares <= 0) throw Error(`${label}: invalid quantity.`);
    let componentFees = 0;
    const seen = new Set<string>();
    const residue = feeText.replace(/([A-Z]+):(\d+(?:\.\d+)?)/g, (_, key: string, value: string) => {
      if (!FEE_LABELS.has(key)) throw Error(`${label}: unknown charge "${key}"; refusing to guess whether it is a fee.`);
      if (seen.has(key)) throw Error(`${label}: charge "${key}" appears twice.`);
      seen.add(key);
      componentFees += Number(value);
      return '';
    });
    if (residue.trim()) throw Error(`${label}: unexpected text in trade narration: "${residue.trim().slice(0, 40)}".`);
    componentFees = round4(componentFees);
    const kind = side === 'Buy' ? 'buy' : 'sell';
    if (kind === 'buy' ? !(debit > 0 && credit === 0) : !(credit > 0 && debit === 0))
      throw Error(`${label}: a ${side.toLowerCase()} must be a ${kind === 'buy' ? 'debit' : 'credit'}.`);
    const netCash = kind === 'buy' ? debit : credit;
    const gross = kind === 'buy' ? netCash - componentFees : netCash + componentFees;
    if (!(gross > 0)) throw Error(`${label}: fees exceed the cash amount.`);
    const quotient = gross / shares;
    const snapped = Math.round(quotient * 100) / 100;
    const priceSnapped = snapped > 0 && Math.abs(snapped * shares - gross) <= SNAP_TOLERANCE;
    const price = priceSnapped ? snapped : Math.round(quotient * 1e6) / 1e6;
    const fees = round4(kind === 'buy' ? netCash - shares * price : shares * price - netCash);
    if (fees < 0) throw Error(`${label}: reconstructed fees are negative.`);
    if (Math.abs(fees - componentFees) > 0.0105)
      throw Error(`${label}: disclosed fees (${componentFees.toFixed(4)}) do not reconcile with the cash amount.`);
    if (!priceSnapped) warnings.push(`${label}: ${ticker} price ${price} is not on a 0.01 tick; kept unrounded so cash still matches.`);
    const n = Number(tPlus) as 1 | 2;
    const exec = executionDateFromSettlement(date, n);
    let certain = exec.certain;
    if (n === 1 && exec.date < SETTLEMENT_T1_FROM) certain = false;
    const base = `${draft.voucher}|${ticker}|${kind}|${shares}|${paisa(netCash)}`;
    const occurrence = (multiplicity.get(base) ?? 0) + 1;
    multiplicity.set(base, occurrence);
    trades.push({
      ticker, kind, shares, price, priceSnapped, componentFees, fees, netCash,
      voucher: draft.voucher, settlementDate: date, settlement: `T+${n}`,
      executionDate: exec.date, dateCertainty: certain ? 'confirmed' : 'inferred',
      printedRate: Number(printedRate), page: draft.page,
      identity: `ahlpdf:${fingerprintValue}:${draft.voucher}:${ticker}:${kind[0]}${shares}:${paisa(netCash)}:${occurrence}`,
      statementRef: `${fingerprintValue}:${draft.voucher}`,
    });
  }

  const sumDebit = rows.reduce((a, r) => a + paisa(r.debit), 0);
  const sumCredit = rows.reduce((a, r) => a + paisa(r.credit), 0);
  if (Math.abs(sumDebit - paisa(totals.debit)) > CASH_TOLERANCE_PAISA || Math.abs(sumCredit - paisa(totals.credit)) > CASH_TOLERANCE_PAISA)
    throw Error('The ledger rows do not add up to the printed totals; a row or page is missing or unreadable.');
  if (Math.abs(paisa(rows[rows.length - 1].balance) - paisa(totals.balance)) > CASH_TOLERANCE_PAISA)
    throw Error('The last running balance does not match the printed closing balance.');

  const excluded = new Map<ExcludedSummary['category'], ExcludedSummary>();
  for (const row of rows) {
    if (row.category === 'trade') continue;
    const entry = excluded.get(row.category) ?? { category: row.category, count: 0, debit: 0, credit: 0 };
    entry.count++;
    entry.debit = Math.round((entry.debit + row.debit) * 100) / 100;
    entry.credit = Math.round((entry.credit + row.credit) * 100) / 100;
    excluded.set(row.category, entry);
  }
  if (excluded.has('other'))
    warnings.push(`${excluded.get('other')!.count} ledger entr${excluded.get('other')!.count === 1 ? 'y was' : 'ies were'} not recognised as a trade, deposit, withdrawal, interest or charge and ${excluded.get('other')!.count === 1 ? 'is' : 'are'} excluded.`);
  return {
    format: 'ahl-client-ledger', pages: pageTexts.length, from, to, generated,
    accountFingerprint: fingerprintValue, rows, trades,
    excluded: [...excluded.values()], totals, warnings,
  };
}
