// What the old server did around a portfolio read/save, now done locally on the decrypted portfolio:
//  - load: overlay the shared quote cache (never over a newer saved/manual quote), repair placeholder company
//    names from the public directory, and attach payout announcements and verified face values;
//  - save: fill in details for new companies (strict for the explicit Add Company intent), validate what is
//    actually stored, then encrypt and store it.
// Public lookups go through `PublicData`, which only ever sends tickers. The result keeps the PortfolioResponse /
// SavePortfolioResponse shapes the screens already use.
import type { CompanyLookup, PortfolioResponse, PublicDataResponse, SavePortfolioResponse } from './api-types.ts';
import { applyLookups, hasPlaceholderDetails, newTickers } from './company-enrichment.ts';
import { planAutoDividendUpdate } from './dividend-sync.ts';
import { mergeQuotes } from './quote-merge.ts';
import { validate, type Portfolio } from './portfolio.ts';
import { type PortfolioAccount, type PortfolioTarget } from './portfolio-account.ts';
import { ConflictError, type VaultSession } from './vault-client.ts';

export type PublicData = {
  /** Cached quotes, announcements and face values for these tickers. */
  market(tickers: string[]): Promise<PublicDataResponse>;
  /** Cached directory details (read-only). */
  companies(tickers: string[]): Promise<CompanyLookup[]>;
  /** Asks the server to look up symbols it does not know yet (best effort). */
  requestLookup(tickers: string[]): Promise<void>;
  /** Public gold and silver rates (no parameters). */
  metalRates?(): Promise<import('./metal-rates.ts').MetalRateRow[]>;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const tickersOf = (portfolio: Portfolio) => portfolio.companies.map((company) => company.ticker);

/** Pure: merges public data into a copy of the decrypted portfolio. */
export function applyPublicData(
  stored: Portfolio,
  market: PublicDataResponse | null,
  lookups: CompanyLookup[] = [],
): { portfolio: Portfolio; announcements: PortfolioResponse['announcements']; faceValues: NonNullable<PortfolioResponse['faceValues']>; pendingCompanies: string[] } {
  const portfolio = clone(stored);
  if (market) portfolio.quotes = mergeQuotes(portfolio.quotes ?? {}, market.quoteRows, tickersOf(portfolio));
  applyLookups(portfolio.companies, lookups);
  const placeholders = portfolio.companies.filter(hasPlaceholderDetails).map((company) => company.ticker);
  return { portfolio, announcements: market?.announcements ?? [], faceValues: market?.faceValues ?? {}, pendingCompanies: placeholders };
}

async function lookupPlaceholders(portfolio: Portfolio, publicData: PublicData): Promise<CompanyLookup[]> {
  const placeholders = portfolio.companies.filter(hasPlaceholderDetails).map((company) => company.ticker);
  if (!placeholders.length) return [];
  try {
    return await publicData.companies(placeholders);
  } catch {
    return [];
  }
}

/** Reload + decrypt + overlay. Public data is best effort: offline or a hiccup shows the portfolio without it. */
export async function loadPortfolioView(session: VaultSession, publicData: PublicData, target?: PortfolioTarget): Promise<PortfolioResponse> {
  const { portfolio: stored, revision } = await session.reload(target);
  const tickers = tickersOf(stored);
  const market = tickers.length ? await publicData.market(tickers).catch(() => null) : null;
  const lookups = await lookupPlaceholders(stored, publicData);
  const view = applyPublicData(stored, market, lookups);
  return { portfolio: view.portfolio, revision, announcements: view.announcements ?? [], pendingCompanies: view.pendingCompanies, faceValues: view.faceValues };
}

export class CompanyDetailsError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'CompanyDetailsError';
    this.status = status;
  }
}

/**
 * Same contract as the old PUT /api/portfolio: `createCompanies` is the strict Add Company intent (new to the
 * portfolio and fully resolved), anything else is tolerant and keeps unresolved companies as entered. Mutates
 * `incoming` with the resolved details, as the server did before.
 */
export async function savePortfolioView(
  session: VaultSession,
  publicData: PublicData,
  incoming: Portfolio,
  revision: number,
  createCompanies: readonly string[] = [],
  target?: PortfolioTarget,
): Promise<SavePortfolioResponse> {
  const previous = session.portfolioFor(target);
  const added = new Set(newTickers(previous, incoming));
  const present = new Set(tickersOf(incoming));
  const strict = [...new Set(createCompanies)];
  for (const ticker of strict) {
    if (!present.has(ticker)) throw new CompanyDetailsError(`${ticker} is not part of this save.`, 400);
    if (!added.has(ticker)) throw new CompanyDetailsError(`${ticker} is already in your portfolio.`, 400);
  }
  const wanted = [...new Set([...added, ...incoming.companies.filter(hasPlaceholderDetails).map((company) => company.ticker)])];
  let details: { ticker: string; name: string; sector: string }[] = [];
  let pending: string[] = [];
  if (wanted.length) {
    let lookups: CompanyLookup[] | null = null;
    try {
      lookups = await publicData.companies(wanted);
    } catch {
      if (strict.length) throw new CompanyDetailsError('Company details could not be checked right now. Please try again.', 503);
    }
    if (lookups) {
      const unresolved = lookups.filter((lookup) => lookup.state !== 'resolved').map((lookup) => lookup.ticker);
      const blocked = strict.filter((ticker) => unresolved.includes(ticker));
      if (blocked.length)
        throw new CompanyDetailsError(`Company details for ${blocked.join(', ')} are not available yet. Check the symbol, or wait for the lookup to finish and try again.`);
      const repaired = new Set(applyLookups(incoming.companies, lookups, added));
      details = incoming.companies.filter((company) => repaired.has(company.ticker)).map(({ ticker, name, sector }) => ({ ticker, name, sector }));
      pending = unresolved;
      if (unresolved.length) void publicData.requestLookup(unresolved).catch(() => {});
    } else pending = wanted;
  }
  // Validate what is actually stored: after the details were filled in.
  validate(incoming);
  const saved = await session.save(incoming, revision, target);
  return { revision: saved, details, pendingCompanies: pending };
}

export { ConflictError };

/** One public fetch for the union of tickers, then an independent overlay on every ledger. */
export async function loadAccountView(session: VaultSession, publicData: PublicData, syncDividends = false): Promise<{ account: PortfolioAccount; revision: number }> {
  return session.guarded(async () => {
    let { account, revision } = await session.reload();
    const tickers = [...new Set(account.portfolios.flatMap((p) => tickersOf(p.portfolio)))];
    const placeholders = [...new Set(account.portfolios.flatMap((p) => p.portfolio.companies.filter(hasPlaceholderDetails).map((c) => c.ticker)))];
    const [market, lookups] = await Promise.all([
      tickers.length ? publicData.market(tickers).catch(() => null) : null,
      placeholders.length ? publicData.companies(placeholders).catch(() => []) : [],
    ]);
    if (syncDividends && market && !session.offline) {
      let changed = false;
      const updated = { ...account, portfolios: account.portfolios.map((entry) => {
        if (entry.locked) return entry;
        const update = planAutoDividendUpdate(entry.portfolio, market.announcements ?? [], undefined, undefined, market.faceValues ?? {});
        if (!update) return entry;
        changed = true;
        return { ...entry, portfolio: update.next };
      }) };
      if (changed) {
        try { revision = await session.saveAccount(updated, revision); account = updated; }
        catch (error) { if (!(error instanceof ConflictError)) throw error; return loadAccountView(session, publicData, false); }
      }
    }
    return { account: { ...account, portfolios: account.portfolios.map((entry) => ({ ...entry, portfolio: applyPublicData(entry.portfolio, market, lookups).portfolio })) }, revision };
  });
}
