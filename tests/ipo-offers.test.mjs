import test from 'node:test';
import assert from 'node:assert/strict';
import { priceAssumedAcquisition } from '../lib/ipo-offers.ts';
import { CURATED_IPO_OFFERS, extractListingNotice, extractOfferPrice, lookupFromEvidence, lookupFromRow } from '../lib/ipo-evidence.ts';

test('offer price is extracted only when every statement agrees', () => {
  assert.equal(extractOfferPrice('through the Fixed Price Method at an Offer Price of PKR 10.70/- per unit (including a premium)\nOffer Price PKR 10.70 per unit'), 10.7);
  assert.equal(extractOfferPrice('Offer Price of PKR 10.70 ... later Offer Price of PKR 11.00'), null);
  assert.equal(extractOfferPrice('The Offer Price will be determined by book building'), null);
  assert.equal(extractOfferPrice('Opening Price of the units will be PKR 10.70/- per unit'), null, 'an opening price is not an offer price');
});

test('listing notice yields symbol, first trading date and no invented allotment date', () => {
  const notice =
    'LISTING OF JS RENTAL REIT (JSRR) ... listing of JS Rental REIT (“JSRR” or “the REIT Scheme”) with effect from Monday, May 18, 2026. Trading in the units will commence on the Main Board of PSX from Monday, May 18, 2026';
  const parsed = extractListingNotice(notice);
  assert.equal(parsed.symbol, 'JSRR');
  assert.equal(parsed.listingDate, '2026-05-18');
  assert.equal(parsed.allotmentDate, null);
  assert.equal(extractListingNotice('The allotment of units will be made on Friday, May 8, 2026.').allotmentDate, '2026-05-08');
});

test('extracted evidence is never curated; missing price is a not-found', () => {
  const found = lookupFromEvidence({ ticker: 'ABCD', offerPrice: 25, listingDate: '2024-05-01', allotmentDate: null, evidence: [{ url: 'https://x.test/a.pdf', title: 't' }], checkedAt: 'now' });
  assert.equal(found.status, 'found');
  assert.equal(found.verification, 'extracted');
  assert.equal(lookupFromEvidence({ ticker: 'ABCD', offerPrice: null, listingDate: null, allotmentDate: null, evidence: [], checkedAt: 'now' }).status, 'not-found');
});

test('lookupFromRow: curated first, stored rows next, unknown symbols explicit', () => {
  assert.equal(lookupFromRow('JSRR', null).verification, 'curated');
  assert.equal(lookupFromRow('ZZZZ', null).status, 'not-found');
  const base = { ticker: 'ZZZZ', offer_price: null, allotment_date: null, listing_date: null, evidence: null, verification: null, reason: null, error: null, checked_at: 'x' };
  assert.equal(lookupFromRow('ZZZZ', { ...base, status: 'failed', error: 'timeout' }).status, 'failed');
  const stored = lookupFromRow('ZZZZ', { ...base, status: 'found', offer_price: 12, listing_date: '2020-01-02', evidence: '[{"url":"https://x.test","title":"t"}]', verification: 'extracted' });
  assert.equal(stored.status, 'found');
  assert.equal(stored.verification, 'extracted');
});

test('curated JSRR entry prices an acquisition at the verified offer on the listing date', () => {
  const pricing = priceAssumedAcquisition({ ticker: 'JSRR', saleDate: '2026-06-29', salePrice: 10.7, lookup: CURATED_IPO_OFFERS[0] });
  assert.equal(pricing.basis, 'ipo-offer');
  assert.equal(pricing.price, 10.7);
  assert.equal(pricing.date, '2026-05-18');
  assert.equal(pricing.dateBasis, 'listing');
  assert.match(pricing.label, /inferred/);
});
