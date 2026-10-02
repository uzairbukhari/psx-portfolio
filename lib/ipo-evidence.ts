// Curated and extracted official IPO evidence (see lib/ipo-offers.ts for how it is priced).
import type { IpoEvidence, IpoLookup } from './ipo-offers.ts';

/**
 * Offers checked by hand against the final official documents. `extracted` evidence from the scraper
 * never replaces these. Add an entry only after reading the final offer document (not a draft, an
 * opening-price notice or a news item).
 */
export const CURATED_IPO_OFFERS: Extract<IpoLookup, { status: 'found' }>[] = [
  {
    status: 'found',
    ticker: 'JSRR',
    // Final OFSD, section "Offer Size / Offer Price": fixed-price method at PKR 10.70 per unit (0.70 premium).
    offerPrice: 10.7,
    // Subscription ran 5-6 May 2026; no allotment date is published in these documents, so the first
    // trading day from PSX notice PSX/N-608 is used (an inferred date, labelled as such).
    listingDate: '2026-05-18',
    evidence: [
      {
        url: 'https://jsil.com/wp-content/uploads/2026/04/1.-JS-Rental-REIT-OFFER-FOR-SALE-DOCUMENT-2026.pdf',
        title: 'JS Rental REIT offer for sale document: Offer Price PKR 10.70 per unit (fixed price)',
      },
      {
        url: 'https://www.psx.com.pk/psx/themes/psx/uploads/JS-Rental-REIT-Notice-of-Listing-15-05-26.pdf',
        title: 'PSX notice PSX/N-608: trading starts Monday 18 May 2026',
      },
    ],
    verification: 'curated',
    checkedAt: '2026-10-02T00:00:00.000Z',
  },
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const longDate = (text: string): string | null => {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

/**
 * Offer price from the text of an offer document: every "Offer Price of PKR x" must agree, else nothing is
 * extracted (a book-building price range or a drafted/amended figure must not be guessed).
 */
export function extractOfferPrice(text: string): number | null {
  const flat = text.replace(/\s+/g, ' ');
  const prices = [...flat.matchAll(/Offer Price(?: of| is|:)?\s*(?:PKR|Rs\.?)\s*([\d,]+(?:\.\d{1,4})?)/gi)].map((m) =>
    Number(m[1].replace(/,/g, '')),
  );
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (!valid.length || new Set(valid).size !== 1) return null;
  return valid[0];
}

/** Symbol, first trading date and (when stated) allotment date from a PSX notice of listing. */
export function extractListingNotice(text: string): { symbol: string | null; listingDate: string | null; allotmentDate: string | null } {
  const flat = text.replace(/\s+/g, ' ');
  const symbol =
    /\(\s*["“]?([A-Z][A-Z0-9]{1,11})["”]?\s*(?:or|\))/.exec(flat)?.[1] ??
    /Symbol\s*["“]([A-Z0-9]{2,12})["”]/i.exec(flat)?.[1] ??
    null;
  const listed = /(?:with effect from|will commence[^.]*?from)\s+(?:[A-Za-z]+day,\s*)?([A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(flat)?.[1];
  const allotted = /allot(?:ment|ted)[^.]{0,80}?(?:on|date)[^.]{0,20}?((?:[A-Za-z]+day,\s*)?[A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(flat)?.[1];
  return { symbol, listingDate: listed ? longDate(listed) : null, allotmentDate: allotted ? longDate(allotted) : null };
}

/** Folds scraper output for one ticker into a lookup result. Never marks evidence curated. */
export function lookupFromEvidence(input: {
  ticker: string;
  offerPrice: number | null;
  listingDate: string | null;
  allotmentDate: string | null;
  evidence: IpoEvidence[];
  checkedAt: string;
}): IpoLookup {
  if (input.offerPrice === null)
    return { status: 'not-found', ticker: input.ticker, reason: 'No final offer price was found in the official documents.', checkedAt: input.checkedAt };
  return {
    status: 'found',
    ticker: input.ticker,
    offerPrice: input.offerPrice,
    ...(input.allotmentDate ? { allotmentDate: input.allotmentDate } : {}),
    ...(input.listingDate ? { listingDate: input.listingDate } : {}),
    evidence: input.evidence,
    verification: 'extracted',
    checkedAt: input.checkedAt,
  };
}

export type IpoRow = {
  ticker: string;
  status: string;
  offer_price: number | null;
  allotment_date: string | null;
  listing_date: string | null;
  evidence: string | null;
  verification: string | null;
  reason: string | null;
  error: string | null;
  checked_at: string;
};

/** Curated evidence first, then what the scraper stored; a ticker never looked up is reported as such. */
export function lookupFromRow(ticker: string, row: IpoRow | null | undefined): IpoLookup {
  const curated = CURATED_IPO_OFFERS.find((c) => c.ticker === ticker);
  if (curated) return curated;
  if (!row) return { status: 'not-found', ticker, reason: 'No official offer lookup has been run for this symbol yet.', checkedAt: '' };
  if (row.status === 'found' && row.offer_price)
    return {
      status: 'found',
      ticker,
      offerPrice: row.offer_price,
      ...(row.allotment_date ? { allotmentDate: row.allotment_date } : {}),
      ...(row.listing_date ? { listingDate: row.listing_date } : {}),
      evidence: row.evidence ? (JSON.parse(row.evidence) as IpoEvidence[]) : [],
      verification: 'extracted',
      checkedAt: row.checked_at,
    };
  if (row.status === 'failed') return { status: 'failed', ticker, error: row.error ?? 'Lookup failed.', checkedAt: row.checked_at };
  return { status: 'not-found', ticker, reason: row.reason ?? 'No official offer document found.', checkedAt: row.checked_at };
}
