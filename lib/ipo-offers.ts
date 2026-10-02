// Official IPO / offer-for-sale price evidence, used only to price an acquisition the user asked us to
// assume for a sale that has no purchase history (see lib/ahl-reconcile.ts).
//
// The result is explicit about what happened. `found` carries the price, the best date we have and the
// official documents it came from; `not-found` means the lookup ran and nothing was published; `failed`
// means it could not run. `curated` evidence was checked by hand against the final offer document;
// `extracted` evidence was read from a document by code and must be accepted by the user before it is used.

export type IpoEvidence = { url: string; title: string };

export type IpoLookup =
  | {
      status: 'found';
      ticker: string;
      /** Final offer price per share, PKR. */
      offerPrice: number;
      /** Official allotment date when published. */
      allotmentDate?: string;
      /** First trading date on the exchange, when published. */
      listingDate?: string;
      evidence: IpoEvidence[];
      verification: 'curated' | 'extracted';
      checkedAt: string;
    }
  | { status: 'not-found'; ticker: string; reason: string; checkedAt: string }
  | { status: 'failed'; ticker: string; error: string; checkedAt: string };

export type IpoPricing = {
  basis: 'ipo-offer' | 'sale-price-fallback';
  price: number;
  date: string;
  dateBasis: 'allotment' | 'listing' | 'day-before-sale';
  priceSource: string;
  label: string;
  /** Why the fallback was used, when it was. */
  fallbackReason?: string;
};

const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Price and date for an assumed acquisition. The IPO offer is used when it is found, verified (curated, or
 * accepted by the user), and dated no later than the sale; otherwise the gross sale price one calendar day
 * before the sale, with no acquisition fees, which is labelled as the user-requested estimate it is.
 */
export function priceAssumedAcquisition(input: {
  ticker: string;
  saleDate: string;
  salePrice: number;
  lookup?: IpoLookup;
  acceptExtracted?: boolean;
}): IpoPricing {
  const { ticker, saleDate, salePrice, lookup } = input;
  let reason = 'IPO lookup has not run.';
  if (lookup?.status === 'found') {
    const date = lookup.allotmentDate ?? lookup.listingDate;
    const dateBasis = lookup.allotmentDate ? 'allotment' : 'listing';
    if (lookup.verification === 'extracted' && !input.acceptExtracted)
      reason = 'An offer price was read from an official document but is not yet accepted.';
    else if (!date) reason = 'The offer price is known but no allotment or listing date was published.';
    else if (date > saleDate) reason = `The published ${dateBasis} date (${date}) is after the sale.`;
    else
      return {
        basis: 'ipo-offer',
        price: lookup.offerPrice,
        date,
        dateBasis,
        priceSource: lookup.evidence.map((e) => e.url).join(' ').slice(0, 280) || 'official offer document',
        label: `Assumed IPO acquisition at the official offer price Rs ${lookup.offerPrice}; ${dateBasis} date ${date} is inferred, not broker-reported.`,
      };
  } else if (lookup?.status === 'not-found') reason = lookup.reason;
  else if (lookup?.status === 'failed') reason = `IPO lookup failed: ${lookup.error}`;
  return {
    basis: 'sale-price-fallback',
    price: salePrice,
    date: dayBefore(saleDate),
    dateBasis: 'day-before-sale',
    priceSource: `Gross sale price of ${ticker} on ${saleDate}`,
    label: `User-requested fallback estimate, not a broker-reported purchase: ${ticker} bought one day before the sale at the gross selling price Rs ${salePrice}, with zero assumed fees. ${reason}`,
    fallbackReason: reason,
  };
}
