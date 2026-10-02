// Shared PSX company directory: pure parsing, validation, merge and planning logic behind
// `scripts/psx-directory-scrape.mjs` (GitHub Actions) and the resolver (`lib/company-resolver.ts`).
// It extends `security_catalog` (one row per normalized traded symbol; share classes, rights and ETFs are
// separate rows, never folded into an issuer). No Worker or D1 imports, so it is testable with `node --test`.
//
// Rules that hold throughout:
//  - a value that is empty or malformed in a new observation never replaces a good stored one;
//  - provenance is kept per field, and a higher-ranked source (company profile, issuer) is never
//    overwritten by a lower-ranked one (screener / symbol list / All-Share table);
//  - nothing here is derived from a user's portfolio, and nothing is ever deleted because it was missing once.

export const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/;
export const normalizeTicker = (raw: unknown): string | null => {
  const ticker = (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '').trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
};

/** Where a field came from, lowest rank first. `all-share` is the legacy name-only price table. */
export type FieldSource = 'all-share' | 'symbols' | 'screener' | 'profile' | 'issuer';
export const SOURCE_RANK: Record<FieldSource, number> = { 'all-share': 0, symbols: 1, screener: 1, profile: 2, issuer: 3 };
const rankOf = (source: string | null | undefined) => SOURCE_RANK[(source ?? 'all-share') as FieldSource] ?? 0;

export type SecurityType = 'equity' | 'etf' | 'debt';
export type ListingStatus = 'listed' | 'delisted';
export type ResolutionStatus = 'resolved' | 'incomplete' | 'unresolved';

/** One validated observation of a symbol from one source. Absent fields are `null`, never guessed. */
export type Observation = {
  ticker: string;
  name: string | null;
  sectorName: string | null;
  sectorCode: string | null;
  securityType: SecurityType | null;
  listingStatus: ListingStatus | null;
  source: FieldSource;
  sourceUrl: string;
};

/** The stored directory row (the columns of `security_catalog` this module owns). */
export type DirectoryRow = {
  ticker: string;
  name: string;
  sectorName: string | null;
  sectorCode: string | null;
  securityType: SecurityType | null;
  listingStatus: ListingStatus | null;
  nameSource: string | null;
  sectorSource: string | null;
  sourceUrls: string[];
  resolutionStatus: ResolutionStatus;
  verifiedAt: string | null;
  profileFetchedAt: string | null;
  fingerprint: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

// --- text helpers --------------------------------------------------------------------------------------

function stripTags(s: string) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A usable company name: real text, not just the ticker, bounded. */
export function cleanName(raw: unknown, ticker: string): string | null {
  const name = stripTags(typeof raw === 'string' ? raw : '');
  if (name.length < 2 || name.length > 200) return null;
  if (name.toUpperCase() === ticker) return null;
  if (/^(n\/?a|unknown|-|—)$/i.test(name)) return null;
  return name;
}
/** A usable sector label (PSX prints these in capitals). */
export function cleanSector(raw: unknown): string | null {
  const sector = stripTags(typeof raw === 'string' ? raw : '');
  if (sector.length < 2 || sector.length > 100) return null;
  if (/^(n\/?a|unknown|-|—)$/i.test(sector)) return null;
  return sector;
}
/** Readable sector name as the portfolio stores it ("COMMERCIAL BANKS" -> "Commercial Banks"). */
export const readableSector = (raw: string) =>
  raw.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// --- parsers -------------------------------------------------------------------------------------------

export type ParseResult = { rows: Observation[]; rejected: number };

/**
 * PSX `/symbols`: the JSON list its own search box uses, `[{symbol, name, sectorName, isETF, isDebt}]`.
 * A security type is only recorded when both flags are present booleans (it is then stated, not guessed).
 */
export function parseSymbolsJson(text: string, sourceUrl = 'https://dps.psx.com.pk/symbols'): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error('PSX symbol list was not valid JSON');
  }
  if (!Array.isArray(data)) throw Error('PSX symbol list had an unexpected shape');
  const rows: Observation[] = [];
  let rejected = 0;
  for (const raw of data) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const ticker = normalizeTicker(entry.symbol);
    if (!ticker) { rejected++; continue; }
    const stated = typeof entry.isETF === 'boolean' && typeof entry.isDebt === 'boolean';
    rows.push({
      ticker,
      name: cleanName(entry.name, ticker),
      sectorName: cleanSector(entry.sectorName),
      sectorCode: null,
      securityType: stated ? (entry.isETF ? 'etf' : entry.isDebt ? 'debt' : 'equity') : null,
      listingStatus: null,
      source: 'symbols',
      sourceUrl,
    });
  }
  return { rows, rejected };
}

type Table = { headers: string[]; rows: string[][]; rawRows: string[] };
function tables(html: string): Table[] {
  const out: Table[] = [];
  for (const match of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const table = match[0];
    const headers = [...(table.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]).toLowerCase());
    const body = table.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? table;
    const rawRows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    const rows = rawRows.map((row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1])));
    out.push({ headers, rows: rows.filter((r) => r.length), rawRows });
  }
  return out;
}
const findColumn = (headers: string[], ...needles: RegExp[]) => headers.findIndex((h) => needles.some((n) => n.test(h)));

/** `<option value="0801">AUTOMOBILE ASSEMBLER</option>` pairs of the screener's sector filter: code by PSX label. */
export function parseSectorOptions(html: string): Map<string, string> {
  const byLabel = new Map<string, string>();
  for (const select of html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/gi)) {
    if (!/sector/i.test(select[0].slice(0, 300))) continue;
    for (const option of select[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)) {
      const code = option[1].trim();
      const label = cleanSector(option[2]);
      if (label && /^[A-Za-z0-9_-]{1,12}$/.test(code) && !/^all\b/i.test(label)) byLabel.set(label.toUpperCase(), code);
    }
  }
  return byLabel;
}

/**
 * PSX screener table: a header-driven read (Symbol / Name / Sector columns wherever they sit) so a column
 * reorder does not silently shift values. Sector codes come from the page's own sector filter labels.
 */
export function parseScreener(html: string, sourceUrl = 'https://dps.psx.com.pk/screener'): ParseResult {
  const codes = parseSectorOptions(html);
  const rows: Observation[] = [];
  let rejected = 0;
  let found = false;
  for (const table of tables(html)) {
    const symbol = findColumn(table.headers, /^symbol$/, /^ticker$/, /^scrip/);
    if (symbol < 0) continue;
    found = true;
    const name = findColumn(table.headers, /^name$/, /company/, /^security/);
    const sector = findColumn(table.headers, /^sector/);
    for (const cells of table.rows) {
      const ticker = normalizeTicker(cells[symbol]);
      if (!ticker) { rejected++; continue; }
      const sectorName = sector >= 0 ? cleanSector(cells[sector]) : null;
      rows.push({
        ticker,
        name: name >= 0 ? cleanName(cells[name], ticker) : null,
        sectorName,
        sectorCode: sectorName ? (codes.get(sectorName.toUpperCase()) ?? null) : null,
        securityType: null,
        listingStatus: null,
        source: 'screener',
        sourceUrl,
      });
    }
  }
  if (!found) throw Error('PSX screener markup had no symbol table');
  return { rows, rejected };
}

/**
 * PSX listings page: symbols by listing status. A table under a heading or caption that mentions
 * "delisted" / "suspended" is not reported as listed; everything else is a listed symbol.
 */
export function parseListings(html: string, sourceUrl = 'https://dps.psx.com.pk/listings'): ParseResult {
  const rows: Observation[] = [];
  let rejected = 0;
  let found = false;
  for (const match of html.matchAll(/(?:<(?:h[1-6]|caption|legend)[^>]*>([\s\S]*?)<\/(?:h[1-6]|caption|legend)>\s*)?<table[\s\S]*?<\/table>/gi)) {
    const heading = stripTags(match[1] ?? '');
    const table = tables(match[0])[0];
    if (!table) continue;
    const symbol = findColumn(table.headers, /^symbol$/, /^ticker$/, /^scrip/);
    if (symbol < 0) continue;
    found = true;
    const name = findColumn(table.headers, /^name$/, /company/);
    const sector = findColumn(table.headers, /^sector/);
    const status: ListingStatus = /delist/i.test(heading) ? 'delisted' : 'listed';
    for (const cells of table.rows) {
      const ticker = normalizeTicker(cells[symbol]);
      if (!ticker) { rejected++; continue; }
      rows.push({
        ticker,
        name: name >= 0 ? cleanName(cells[name], ticker) : null,
        sectorName: sector >= 0 ? cleanSector(cells[sector]) : null,
        sectorCode: null,
        securityType: null,
        listingStatus: status,
        source: 'symbols',
        sourceUrl,
      });
    }
  }
  if (!found) throw Error('PSX listings markup had no symbol table');
  return { rows, rejected };
}

/**
 * The identity block of a company page (`quote__name`, `quote__sector`). Unlike the facts parser this
 * returns `null` for anything missing instead of a placeholder, and never needs a price.
 */
export function parseCompanyProfile(html: string, ticker: string, sourceUrl = `https://dps.psx.com.pk/company/${ticker}`): Observation | null {
  const name = cleanName(html.match(/quote__name">([^<]*)/)?.[1], ticker);
  const sectorName = cleanSector(html.match(/quote__sector"><span>([^<]*)/)?.[1]);
  if (!name && !sectorName) return null;
  return { ticker, name, sectorName, sectorCode: null, securityType: null, listingStatus: null, source: 'profile', sourceUrl };
}

// --- merge ---------------------------------------------------------------------------------------------

/** Stable hash of the observed fields; changes exactly when the listing's identity data changes. */
export function fingerprintOf(row: Pick<DirectoryRow, 'name' | 'sectorName' | 'sectorCode' | 'securityType' | 'listingStatus'>): string {
  const text = [row.name, row.sectorName ?? '', row.sectorCode ?? '', row.securityType ?? '', row.listingStatus ?? ''].join('␟');
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export const isPlaceholderName = (name: string | null | undefined, ticker: string) => !name || name.trim() === '' || name.trim().toUpperCase() === ticker;

export function statusOf(row: Pick<DirectoryRow, 'ticker' | 'name' | 'sectorName' | 'nameSource' | 'sectorSource'>, previous?: ResolutionStatus): ResolutionStatus {
  const named = !isPlaceholderName(row.name, row.ticker) && rankOf(row.nameSource) >= 1;
  const sectored = !!row.sectorName && rankOf(row.sectorSource) >= 1;
  if (named && sectored) return 'resolved';
  return previous === 'unresolved' ? 'unresolved' : 'incomplete';
}

export type MergeResult = { row: DirectoryRow; changed: boolean; created: boolean };

/**
 * Folds one observation into the stored row (or creates it). A field is replaced only by a valid value
 * from a source of at least the same rank; an empty or malformed field never erases a stored one.
 */
export function mergeObservation(existing: DirectoryRow | null, obs: Observation, now: string): MergeResult {
  const rank = SOURCE_RANK[obs.source];
  const base: DirectoryRow = existing ?? {
    ticker: obs.ticker, name: obs.ticker, sectorName: null, sectorCode: null, securityType: null, listingStatus: null,
    nameSource: null, sectorSource: null, sourceUrls: [], resolutionStatus: 'incomplete', verifiedAt: null,
    profileFetchedAt: null, fingerprint: null, firstSeenAt: now, lastSeenAt: now,
  };
  const next: DirectoryRow = { ...base, sourceUrls: [...base.sourceUrls], lastSeenAt: now > base.lastSeenAt ? now : base.lastSeenAt };

  if (obs.name && (isPlaceholderName(next.name, next.ticker) || rank >= rankOf(next.nameSource))) {
    next.name = obs.name;
    next.nameSource = obs.source;
  }
  if (obs.sectorName && (!next.sectorName || rank >= rankOf(next.sectorSource))) {
    next.sectorName = obs.sectorName;
    next.sectorSource = obs.source;
    next.sectorCode = obs.sectorCode ?? (next.sectorName === base.sectorName ? base.sectorCode : null);
  } else if (obs.sectorCode && obs.sectorName && obs.sectorName === next.sectorName) next.sectorCode = obs.sectorCode;
  if (obs.securityType) next.securityType = obs.securityType;
  if (obs.listingStatus) next.listingStatus = obs.listingStatus;
  if (obs.sourceUrl && !next.sourceUrls.includes(obs.sourceUrl)) next.sourceUrls.push(obs.sourceUrl);
  if (obs.source === 'profile') next.profileFetchedAt = now;

  next.resolutionStatus = statusOf(next, base.resolutionStatus);
  if (next.resolutionStatus === 'resolved' && (obs.source === 'profile' || obs.source === 'issuer' || !base.verifiedAt)) next.verifiedAt = now;
  const fingerprint = fingerprintOf(next);
  const changed = !existing || fingerprint !== existing.fingerprint || next.resolutionStatus !== existing.resolutionStatus;
  next.fingerprint = fingerprint;
  return { row: next, changed, created: !existing };
}

// --- run planning --------------------------------------------------------------------------------------

export type RunMode = 'bootstrap' | 'incremental' | 'full';

export type RunPlan = {
  /** Symbols to fetch a company profile for, oldest need first. */
  profiles: string[];
  /** Symbols seen for the first time. */
  created: string[];
  /** Existing symbols whose list observation differs from what is stored. */
  changed: string[];
};

/**
 * Decides which symbols need a (comparatively expensive) profile fetch.
 *  - bootstrap: every symbol that has no profile yet, so an interrupted bootstrap resumes where it stopped;
 *  - incremental: new symbols, symbols whose listing data changed, and ones still incomplete;
 *  - full: everything.
 * `limit` bounds one run; the rest is picked up next time (nothing is lost, rows stay incomplete).
 */
export function planRun(
  merged: { row: DirectoryRow; changed: boolean; created: boolean }[],
  mode: RunMode,
  options: { limit?: number } = {},
): RunPlan {
  const created = merged.filter((m) => m.created).map((m) => m.row.ticker);
  const changed = merged.filter((m) => !m.created && m.changed).map((m) => m.row.ticker);
  const needs = merged.filter((m) => {
    const { row } = m;
    if (mode === 'full') return true;
    if (mode === 'bootstrap') return !row.profileFetchedAt;
    return m.created || m.changed || row.resolutionStatus !== 'resolved';
  });
  // Never-fetched first, then least recently fetched, so a bounded run always makes progress.
  needs.sort((a, b) => (a.row.profileFetchedAt ?? '').localeCompare(b.row.profileFetchedAt ?? '') || a.row.ticker.localeCompare(b.row.ticker));
  const profiles = needs.map((m) => m.row.ticker).slice(0, options.limit ?? Infinity);
  return { profiles, created, changed };
}

// --- coverage ------------------------------------------------------------------------------------------

export type CoverageReport = {
  discovered: number;
  resolved: number;
  incomplete: number;
  unresolved: number;
  /** In the screener but absent from the listings page, and the reverse: sources disagree about coverage. */
  screenerOnly: string[];
  listingsOnly: string[];
  /** Priced in the All-Share table but in neither list: the All-Share list alone is not proof of coverage. */
  allShareOnly: string[];
  delisted: number;
};

export function coverageReport(
  rows: Pick<DirectoryRow, 'ticker' | 'resolutionStatus' | 'listingStatus'>[],
  sources: { screener: string[]; listings: string[]; allShare: string[] },
): CoverageReport {
  const screener = new Set(sources.screener);
  const listings = new Set(sources.listings);
  return {
    discovered: rows.length,
    resolved: rows.filter((r) => r.resolutionStatus === 'resolved').length,
    incomplete: rows.filter((r) => r.resolutionStatus === 'incomplete').length,
    unresolved: rows.filter((r) => r.resolutionStatus === 'unresolved').length,
    screenerOnly: [...screener].filter((t) => !listings.has(t)).sort(),
    listingsOnly: [...listings].filter((t) => !screener.has(t)).sort(),
    allShareOnly: sources.allShare.filter((t) => !screener.has(t) && !listings.has(t)).sort(),
    delisted: rows.filter((r) => r.listingStatus === 'delisted').length,
  };
}

// --- D1 persistence (statements are built here so the script and tests share them) ---------------------

/** Columns written per row by `directoryUpsertSql`. */
export const DIRECTORY_COLUMNS_PER_ROW = 17;
/** D1 allows 100 bound parameters per statement. */
export const DIRECTORY_ROWS_PER_STATEMENT = Math.floor(100 / DIRECTORY_COLUMNS_PER_ROW);

export function directoryUpsertSql(rows: number): string {
  return `INSERT INTO security_catalog (ticker,name,sector_name,sector_code,security_type,listing_status,name_source,sector_source,source_urls,resolution_status,verified_at,profile_fetched_at,fingerprint,first_seen_at,last_seen_at,source,sector)
          VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}
          ON CONFLICT(ticker) DO UPDATE SET
            name=excluded.name, sector_name=excluded.sector_name, sector_code=excluded.sector_code,
            security_type=excluded.security_type, listing_status=excluded.listing_status,
            name_source=excluded.name_source, sector_source=excluded.sector_source, source_urls=excluded.source_urls,
            resolution_status=excluded.resolution_status, verified_at=excluded.verified_at,
            profile_fetched_at=excluded.profile_fetched_at, fingerprint=excluded.fingerprint,
            last_seen_at=MAX(security_catalog.last_seen_at, excluded.last_seen_at),
            source=excluded.source, sector=excluded.sector`;
}
export const directoryRowParams = (r: DirectoryRow) => [
  r.ticker, r.name, r.sectorName, r.sectorCode, r.securityType, r.listingStatus, r.nameSource, r.sectorSource,
  JSON.stringify(r.sourceUrls), r.resolutionStatus, r.verifiedAt, r.profileFetchedAt, r.fingerprint, r.firstSeenAt, r.lastSeenAt,
  r.nameSource ?? 'directory', r.sectorName ? readableSector(r.sectorName) : null,
];

type StoredRow = {
  ticker: string; name: string; sector_name: string | null; sector_code: string | null; security_type: string | null; listing_status: string | null;
  name_source: string | null; sector_source: string | null; source_urls: string | null; resolution_status: string; verified_at: string | null;
  profile_fetched_at: string | null; fingerprint: string | null; first_seen_at: string; last_seen_at: string;
};
export const DIRECTORY_SELECT =
  'ticker,name,sector_name,sector_code,security_type,listing_status,name_source,sector_source,source_urls,resolution_status,verified_at,profile_fetched_at,fingerprint,first_seen_at,last_seen_at';

export function rowFromStored(row: StoredRow): DirectoryRow {
  let urls: string[] = [];
  try {
    const parsed = JSON.parse(row.source_urls ?? '[]');
    if (Array.isArray(parsed)) urls = parsed.filter((u): u is string => typeof u === 'string');
  } catch { /* keep empty */ }
  return {
    ticker: row.ticker, name: row.name, sectorName: row.sector_name, sectorCode: row.sector_code,
    securityType: (row.security_type as SecurityType | null) ?? null, listingStatus: (row.listing_status as ListingStatus | null) ?? null,
    nameSource: row.name_source, sectorSource: row.sector_source, sourceUrls: urls,
    resolutionStatus: (row.resolution_status as ResolutionStatus) ?? 'incomplete', verifiedAt: row.verified_at,
    profileFetchedAt: row.profile_fetched_at, fingerprint: row.fingerprint, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
  };
}
