// Shared company resolver: answers "what is this symbol?" from the shared directory without ever touching
// PSX from the Worker. Resolution order: the directory master row, then already-verified company facts, then
// the state of a background lookup (`refresh_requests` kind 'company', run by psx-directory.yml). A symbol
// with no evidence is reported honestly as `unresolved`; nothing is guessed.
import type { CompanyLookup } from './api-types.ts';
import { DIRECTORY_SELECT, TICKER_PATTERN, isPlaceholderName, readableSector, rowFromStored, type DirectoryRow } from './company-directory.ts';
import { readRequests, tickerState, type TickerState } from './workflow-requests.ts';

export const MAX_LOOKUP_TICKERS = 50;
const CHUNK = 90;

const MESSAGES = {
  pending: 'Looking up this company. This can take a few minutes.',
  unknown: 'No company details are on file for this symbol yet.',
  failed: 'Company details could not be confirmed yet. Please try again later.',
  incomplete: 'Company details are incomplete so far. A lookup can fill them in.',
};

/** Distinct, well-formed tickers, at most `max` (the cap protects the lookup and its dispatch). */
export function cleanLookupTickers(input: unknown, max = MAX_LOOKUP_TICKERS): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  return [...new Set(raw.map((t) => String(t).trim().toUpperCase()).filter((t) => TICKER_PATTERN.test(t)))].slice(0, max);
}

type CatalogRow = Parameters<typeof rowFromStored>[0] & { face_value: number | null };

function fromDirectory(row: DirectoryRow, faceValue: number | null): CompanyLookup['company'] {
  return {
    name: row.name,
    sector: readableSector(row.sectorName ?? ''),
    sectorCode: row.sectorCode,
    securityType: row.securityType,
    listingStatus: row.listingStatus,
    faceValue: faceValue !== null && faceValue > 0 ? faceValue : null,
  };
}

/** Cached lookup for each ticker, in input order. Read-only: it never dispatches or writes. */
export async function lookupCompanies(db: D1Database, tickers: string[], now = Date.now()): Promise<CompanyLookup[]> {
  const unique = [...new Set(tickers)];
  const master = new Map<string, { row: DirectoryRow; faceValue: number | null }>();
  const facts = new Map<string, { name: string; sector: string }>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const marks = part.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT ${DIRECTORY_SELECT},face_value FROM security_catalog WHERE ticker IN (${marks})`)
      .bind(...part)
      .all<CatalogRow>();
    for (const row of rows.results) master.set(row.ticker, { row: rowFromStored(row), faceValue: row.face_value });
  }
  const needFacts = unique.filter((t) => master.get(t)?.row.resolutionStatus !== 'resolved');
  for (let i = 0; i < needFacts.length; i += CHUNK) {
    const part = needFacts.slice(i, i + CHUNK);
    const rows = await db
      .prepare(`SELECT ticker,payload FROM company_facts WHERE ticker IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ ticker: string; payload: string }>()
      .catch(() => ({ results: [] as { ticker: string; payload: string }[] }));
    for (const row of rows.results) {
      try {
        const parsed = JSON.parse(row.payload) as { name?: string; sector?: string };
        const name = String(parsed.name ?? '').trim();
        const sector = String(parsed.sector ?? '').trim();
        // The facts parser falls back to the ticker / "Unknown" when PSX printed nothing: not evidence.
        if (!isPlaceholderName(name, row.ticker) && sector && !/^unknown$/i.test(sector)) facts.set(row.ticker, { name, sector });
      } catch { /* an unreadable facts row is simply not evidence */ }
    }
  }
  const unresolved = unique.filter((t) => master.get(t)?.row.resolutionStatus !== 'resolved' && !facts.has(t));
  const requests = unresolved.length ? await readRequests(db, 'company', unresolved).catch(() => new Map()) : new Map();

  return tickers.map((ticker): CompanyLookup => {
    const entry = master.get(ticker);
    if (entry?.row.resolutionStatus === 'resolved')
      return { ticker, state: 'resolved', company: fromDirectory(entry.row, entry.faceValue), source: 'directory', message: null, canRequest: false };
    const fact = facts.get(ticker);
    if (fact)
      return {
        ticker, state: 'resolved', source: 'facts', message: null, canRequest: false,
        company: { name: fact.name, sector: readableSector(fact.sector), sectorCode: null, securityType: null, listingStatus: null, faceValue: entry?.faceValue && entry.faceValue > 0 ? entry.faceValue : null },
      };
    const request: TickerState = tickerState(requests.get(ticker), ticker, now);
    if (request.state === 'queued' || request.state === 'running')
      return { ticker, state: 'pending', company: null, source: null, message: MESSAGES.pending, canRequest: false };
    if (request.state === 'failed' || entry?.row.resolutionStatus === 'unresolved')
      return { ticker, state: 'unresolved', company: null, source: null, message: MESSAGES.failed, canRequest: true };
    return { ticker, state: 'unresolved', company: null, source: null, message: entry ? MESSAGES.incomplete : MESSAGES.unknown, canRequest: true };
  });
}
