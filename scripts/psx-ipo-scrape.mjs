// Looks up official IPO / offer-for-sale evidence for specific PSX symbols from outside Cloudflare (PSX
// drops Cloudflare egress) and stores it in the shared `ipo_offers` table. It reads PSX's public
// "pride" (IPO) pages, finds the page whose documents name the symbol, and extracts the final offer price
// and first trading date from those documents. Extracted evidence is stored as `extracted`: the app asks the
// user to accept it before pricing anything with it. Hand-checked offers live in lib/ipo-evidence.ts.
//
// Only offers PSX still publishes on its pride pages can be found; older IPOs report `not-found`.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-ipo-scrape.mjs [--dry-run] --tickers=JSRR,ABCD
import { pathToFileURL } from 'node:url';
import { d1, trackedTickers } from './d1-rest.mjs';
import { markFinished, markRunning } from './refresh-state.mjs';
import { extractListingNotice, extractOfferPrice, lookupFromEvidence } from '../lib/ipo-evidence.ts';

const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; psx-portfolio-ipo-lookup)' };
const MAX_PDF_BYTES = 12_000_000;
const MAX_PAGES_PER_PDF = 400;

async function fetchBytes(url, limit = MAX_PDF_BYTES) {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw Error(`${response.status} from ${new URL(url).host}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) throw Error('document too large');
  return bytes;
}

let pdfjsPromise;
async function pdfText(bytes) {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsPromise;
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await task.promise;
  let text = '';
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES_PER_PDF); n++) {
    const page = await doc.getPage(n);
    text += (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  await task.destroy();
  return text;
}

const links = (html, base) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => { try { return new URL(m[1], base).href; } catch { return null; } }).filter(Boolean);

/** Every symbol named by the IPO pages PSX publishes: { page, notices:[{url,text}], offers:[{url,text}] }. */
async function loadPridePages() {
  const indexUrl = 'https://www.psx.com.pk/psx/pride';
  const index = await (await fetch(indexUrl, { headers: UA, signal: AbortSignal.timeout(30_000) })).text();
  const pages = [...new Set(links(index, indexUrl).filter((u) => /\/psx\/pride\/main-board\/[^/]+$/.test(u)))];
  const global = new Set(links(index, indexUrl).filter((u) => u.endsWith('.pdf')));
  const out = [];
  for (const page of pages) {
    try {
      const html = await (await fetch(page, { headers: UA, signal: AbortSignal.timeout(30_000) })).text();
      const pdfs = [...new Set(links(html, page).filter((u) => /\.pdf$/i.test(u) && !global.has(u)))];
      out.push({ page, pdfs });
    } catch (error) {
      console.log(`Skipped ${page}: ${error.message}`);
    }
  }
  return out;
}

async function lookup(ticker, pages, cache) {
  const checkedAt = new Date().toISOString();
  let unreadable = 0;
  const pattern = new RegExp(`(?:\\(|["\\u201c])\\s*${ticker}\\s*(?:\\)|["\\u201d]|\\bor\\b)`);
  for (const { page, pdfs } of pages) {
    const docs = [];
    for (const url of pdfs.filter((u) => /ofs|offer|prospectus|notice|listing/i.test(u))) {
      if (!cache.has(url)) cache.set(url, await (async () => pdfText(await fetchBytes(url)))().catch((e) => { if (process.env.DEBUG_IPO) console.log("unreadable", url, e.message); return null; }));
      if (cache.get(url) === null) unreadable++;
      else docs.push({ url, text: cache.get(url) });
    }
    // A document names its own issuer near the start; a symbol buried deep in a prospectus is usually a peer comparison.
    const named = docs.filter((d) => extractListingNotice(d.text).symbol === ticker || pattern.test(d.text.slice(0, 6000).replace(/\s+/g, ' ')));
    if (!named.length) continue;
    if (process.env.DEBUG_IPO) console.log("named page", page, docs.map((d) => d.url.split("/").pop() + ":" + extractOfferPrice(d.text)));
    const offerDoc = docs.map((d) => ({ d, price: extractOfferPrice(d.text) })).find((x) => x.price !== null);
    const notice = docs.map((d) => ({ d, n: extractListingNotice(d.text) })).find((x) => x.n.symbol === ticker && x.n.listingDate);
    return lookupFromEvidence({
      ticker, offerPrice: offerDoc?.price ?? null,
      listingDate: notice?.n.listingDate ?? null, allotmentDate: notice?.n.allotmentDate ?? null,
      evidence: [offerDoc, notice].filter(Boolean).map((x) => ({ url: x.d.url, title: `PSX IPO documents (${page.split('/').pop()})` })),
      checkedAt,
    });
  }
  return {
    status: 'not-found', ticker, checkedAt,
    reason: `${ticker} is not named in any offer document on PSX's current IPO pages (older offers are not published there)${unreadable ? `; ${unreadable} document(s) could not be read` : ''}.`,
  };
}

async function store(result) {
  await d1(
    `INSERT INTO ipo_offers (ticker,status,offer_price,allotment_date,listing_date,evidence,verification,reason,error,checked_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ticker) DO UPDATE SET status=excluded.status, offer_price=excluded.offer_price,
       allotment_date=excluded.allotment_date, listing_date=excluded.listing_date, evidence=excluded.evidence,
       verification=excluded.verification, reason=excluded.reason, error=excluded.error, checked_at=excluded.checked_at`,
    [
      result.ticker, result.status, result.offerPrice ?? null, result.allotmentDate ?? null, result.listingDate ?? null,
      result.evidence ? JSON.stringify(result.evidence) : null, result.verification ?? null,
      result.reason ?? null, result.error ?? null, result.checkedAt,
    ],
  );
}

async function main() {
  if (!tickerArg) throw Error('Pass --tickers=A,B (the lookup is per symbol).');
  const tickers = (await trackedTickers(tickerArg)).slice(0, 40);
  if (!dryRun) await markRunning('ipo', tickers).catch((e) => console.log(`Request state not updated: ${e.message}`));
  const finished = [];
  let pages = [];
  let pagesError = null;
  try {
    pages = await loadPridePages();
  } catch (error) {
    pagesError = error instanceof Error ? error.message : String(error);
  }
  const cache = new Map();
  for (const ticker of tickers) {
    const result = pagesError
      ? { status: 'failed', ticker, error: `Could not read PSX's IPO pages: ${pagesError}`, checkedAt: new Date().toISOString() }
      : await lookup(ticker, pages, cache).catch((error) => ({ status: 'failed', ticker, error: String(error.message ?? error), checkedAt: new Date().toISOString() }));
    console.log(`${ticker}: ${result.status}${result.offerPrice ? ` offer ${result.offerPrice}` : ''}${result.reason ? ` (${result.reason})` : ''}${result.error ? ` (${result.error})` : ''}`);
    finished.push(result.status === 'failed' ? { ticker, error: result.error } : { ticker, rows: result.status === 'found' ? 1 : 0 });
    if (!dryRun) await store(result);
  }
  if (!dryRun) await markFinished('ipo', finished).catch((e) => console.log(`Request state not updated: ${e.message}`));
  process.exitCode = finished.length && finished.every((f) => f.error) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
