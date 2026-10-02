// Synthetic AHL "Client Ledger" PDFs for tests. Everything here is invented (fictional account "CC00001",
// "TEST CLIENT"); no real statement content is reproduced. The PDF is real, built with positioned text so
// pdf.js + lib/pdf-layout.mjs go through the same extraction as a broker download.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const printDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}-${MON[Number(m) - 1]}-${y.slice(2)}`;
};
const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A trade row from the gross price per share (or an explicit gross total for averaged fills). */
export function trade({ voucher, date, side, ticker, shares, price, gross, settle = 2, split = 'cdc' }) {
  const g = gross ?? r2(shares * price);
  const comm = r2(g * 0.0015 * 100) / 100; // 0.15%
  const commission = Math.round(g * 0.0015 * 10_000) / 10_000;
  const sst = Math.round(commission * 0.15 * 10_000) / 10_000;
  const cdc = Math.round(shares * 0.005 * 10_000) / 10_000;
  void comm;
  const fees = commission + sst + cdc;
  const net = r2(side === 'Buy' ? g + fees : g - fees);
  const rate = (net / shares).toFixed(4);
  const f4 = (n) => n.toFixed(4);
  return {
    voucher, date, kind: 'trade', debit: side === 'Buy' ? net : 0, credit: side === 'Sell' ? net : 0,
    narration: `T+${settle} ${side} ${ticker} ${shares}@${rate} COMM:${f4(commission)}`,
    wrap: split === 'sst-first' ? `SST:${f4(sst)} CDC:${f4(cdc)}` : `SST:${f4(sst)} CDC:${f4(cdc)}`,
    // the SST/CDC part always wraps in this fixture, like the broker's narrow narration column
  };
}
export const deposit = (voucher, date, amount) => ({ voucher, date, narration: 'FUND TRANSFER VIA - Test Bank 111111', debit: 0, credit: amount, effect: 'BB0001' });
export const interest = (voucher, date, amount, month) => ({ voucher, date, narration: 'PROFIT ON UN UTILIZED FUNDS MONTH OF', wrap: month, debit: 0, credit: amount, effect: 'IP0001' });
export const charge = (voucher, date, narration, amount) => ({ voucher, date, narration, debit: amount, credit: 0 });

const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);

/** Build a multi-page PDF. `rowsPerPage` forces page breaks; returns { bytes, rows, totals }. */
export function buildLedgerPdf(entries, { rowsPerPage = 20, from = '2024-11-01', to = '2026-09-29', generated = '2026-09-25', omitTotals = false, dropPage = null, account = 'CC00001' } = {}) {
  let balance = 0, debit = 0, credit = 0;
  const rows = entries.map((e) => {
    balance = r2(balance + e.debit - e.credit);
    debit = r2(debit + e.debit);
    credit = r2(credit + e.credit);
    return { ...e, balance };
  });
  const pageCount = Math.ceil(rows.length / rowsPerPage);
  const pages = [];
  for (let p = 0; p < pageCount; p++) {
    const ops = [];
    let y = 800;
    const text = (x, t, size = 8) => ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
    const line = (dy = 11) => { y -= dy; };
    text(20, 'Arif Habib Limited'); text(300, `From : ${printDate(from).replace(/-(\d\d)$/, '-20$1')} 12:0`); line();
    text(300, `To : ${printDate(to).replace(/-(\d\d)$/, '-20$1')} 12:`); line();
    text(20, 'Client Ledger', 10); line();
    text(20, account); text(100, `Date : ${printDate(generated).replace(/-(\d\d)$/, '-20$1')}`); line();
    text(20, 'Time : 1:55:50pm'); line();
    text(20, 'TEST CLIENT'); line(14);
    text(20, 'Voucher#'); text(85, 'Vch. Date'); text(135, 'Narration'); text(390, 'Debit'); text(450, 'Credit'); text(510, 'Balance'); text(570, 'Effect ChqNO'); line(14);
    for (const row of rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage)) {
      text(20, row.voucher.length > 8 ? row.voucher : row.voucher.replace(/^([A-Z]{2})(\d{6})$/, '$1$2'));
      text(85, printDate(row.date));
      text(135, row.narration);
      text(390, fmt(row.debit)); text(450, fmt(row.credit)); text(510, fmt(row.balance));
      if (row.effect) text(570, row.effect);
      line();
      if (row.wrap) { text(135, row.wrap); line(); }
    }
    if (p === pageCount - 1 && !omitTotals) { line(4); text(390, fmt(debit)); text(450, fmt(credit)); text(510, fmt(balance)); line(); }
    y = 40;
    text(20, `© 2022- All Rights reserved. Arif Habib Limited Page : ${p + 1}`);
    pages.push(ops.join('\n'));
  }
  const keep = pages.filter((_, i) => i !== dropPage);
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const content of keep) {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 640 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { bytes: new Uint8Array(Buffer.from(out, 'latin1')), rows, totals: { debit, credit, balance } };
}

/** The production extraction: pdf.js text items -> lib/pdf-layout.mjs page-marked text. */
export async function extractLikeBrowser(bytes) {
  const require = createRequire(import.meta.url);
  const root = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
  const pdfjs = await import(pathToFileURL(root + 'legacy/build/pdf.mjs').href);
  const { extractMarkedText } = await import('../../lib/pdf-layout.mjs');
  const loading = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await loading.promise;
  try {
    return { text: await extractMarkedText(doc), pages: doc.numPages };
  } finally {
    await loading.destroy();
  }
}
export const readBytes = (path) => new Uint8Array(readFileSync(path));

/** A small invented account history covering the layouts the parser must handle. */
export const entries = () => [
  charge('JV 100001', '2024-11-14', 'Account Opening Fee', 1200),
  deposit('RV 100002', '2024-11-14', 200000),
  trade({ voucher: 'CV241202', date: '2024-12-02', side: 'Buy', ticker: 'AAAA', shares: 30, price: 157.3 }),
  // same voucher, different symbols
  trade({ voucher: 'CV241204', date: '2024-12-04', side: 'Buy', ticker: 'BBBB', shares: 10, price: 366.0 }),
  trade({ voucher: 'CV241204', date: '2024-12-04', side: 'Buy', ticker: 'CCCC', shares: 30, price: 231.1 }),
  interest('MV 120001', '2024-12-05', 71.26, 'NOVEMBER-2024'),
  // two legitimately identical fills on one voucher
  trade({ voucher: 'CV241206', date: '2024-12-06', side: 'Buy', ticker: 'DDDD', shares: 100, price: 22.2 }),
  trade({ voucher: 'CV241206', date: '2024-12-06', side: 'Buy', ticker: 'DDDD', shares: 100, price: 22.2 }),
  trade({ voucher: 'CV241217', date: '2024-12-17', side: 'Sell', ticker: 'AAAA', shares: 10, price: 197.6 }),
  charge('GV 100003', '2025-01-29', 'CGT-DEC-2024', 249.49),
  // averaged multi-fill: gross is not on a 0.01 tick
  trade({ voucher: 'CV250130', date: '2025-01-30', side: 'Sell', ticker: 'DDDD', shares: 119, gross: 2641.96 }),
  // settlement after a lunar holiday: Eid-ul-Fitr 2025 (press-reported) sits inside the T+2 walk
  trade({ voucher: 'CV250403', date: '2025-04-03', side: 'Buy', ticker: 'EEEE', shares: 50, price: 12.5 }),
  trade({ voucher: 'CV260630', date: '2026-06-30', side: 'Sell', ticker: 'IPOX', shares: 1500, price: 10.7, settle: 1 }),
  trade({ voucher: 'CV260817', date: '2026-08-17', side: 'Buy', ticker: 'AAAA', shares: 45, price: 590.0, settle: 1 }),
];

