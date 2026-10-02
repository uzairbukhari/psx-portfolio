// Verified face values: dated evidence per ticker (`security_face_values`), how a dividend date picks the value
// that applied then, and the text extraction that turns an official statement into evidence.
//
// Rules (docs/psx-company-directory-dashboard-progress.md, stage 3):
//  - a value is only ever taken from an explicit statement in a PSX disclosure or an official issuer document,
//    and is stored with its source URL, verification date and the date it applies from;
//  - a current face value never silently applies to a date before a capital change: evidence without a stated
//    "unchanged" or effective date covers only dates on or after the document's own date;
//  - two sources that disagree about the same start date leave the value unresolved (`conflict`);
//  - nothing here is derived from, or written back from, a user's portfolio.
// Pure module (no Worker or D1 imports); the D1 statements are built here so the script and tests share them.

export type FaceValueStatus = 'verified' | 'conflict';
export type FaceValueEvidence = {
  faceValue: number;
  /** First date (YYYY-MM-DD) the value applies from; '' = from the earliest date the evidence covers. */
  effectiveFrom: string;
  sourceUrl: string;
  sourceLabel: string | null;
  evidence: string | null;
  verifiedAt: string;
  status: FaceValueStatus;
};

export type FaceValueResolution =
  | { status: 'verified'; faceValue: number; evidence: FaceValueEvidence }
  | { status: 'unresolved'; reason: 'none' | 'before-coverage' | 'conflict' };

const MAX_FACE_VALUE = 1000;
export const validFaceValue = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_FACE_VALUE;

/** The face value that applied on `date`, or why none can be stated. */
export function resolveFaceValue(history: readonly FaceValueEvidence[] | undefined, date: string): FaceValueResolution {
  const rows = [...(history ?? [])].filter((r) => validFaceValue(r.faceValue)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (!rows.length) return { status: 'unresolved', reason: 'none' };
  let applicable: FaceValueEvidence | null = null;
  for (const row of rows) if (row.effectiveFrom <= date) applicable = row;
  if (!applicable) return { status: 'unresolved', reason: 'before-coverage' };
  if (applicable.status === 'conflict') return { status: 'unresolved', reason: 'conflict' };
  return { status: 'verified', faceValue: applicable.faceValue, evidence: applicable };
}

/** Face value for a company on a date: the account's own explicit value wins, else verified evidence, else null. */
export function faceValueFor(
  company: { faceValue?: number } | undefined,
  evidence: readonly FaceValueEvidence[] | undefined,
  date: string,
): number | null {
  if (company?.faceValue !== undefined && validFaceValue(company.faceValue)) return company.faceValue;
  const resolved = resolveFaceValue(evidence, date);
  return resolved.status === 'verified' ? resolved.faceValue : null;
}

// --- extraction ----------------------------------------------------------------------------------------

export type ExtractContext = {
  sourceUrl: string;
  sourceLabel?: string;
  /** Date of the document itself (YYYY-MM-DD): a face value it states applies from then on. */
  documentDate: string | null;
  verifiedAt: string;
};
export type Extraction = {
  entries: FaceValueEvidence[];
  /** Statements found but not usable (no date, contradictory); reported, never stored. */
  unclear: string[];
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const RS = String.raw`(?:Rs\.?|PKR|Rupees?|Re\.?)`;
const AMOUNT = String.raw`([0-9]+(?:\.[0-9]+)?)`;

/** Parses "March 15, 2024", "15th March 2024", "15-03-2024" or "2024-03-15" to YYYY-MM-DD. */
export function parseStatementDate(text: string): string | null {
  const t = text.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}
function valid(year: number, month: number, day: number): string | null {
  if (!(year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(iso + 'T00:00:00Z');
  return date.getUTCMonth() + 1 === month ? iso : null;
}
const DATE_TEXT = String.raw`(\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]+,?[\s-]+\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})`;

const row = (value: number, effectiveFrom: string, ctx: ExtractContext, snippet: string): FaceValueEvidence => ({
  faceValue: value, effectiveFrom, sourceUrl: ctx.sourceUrl, sourceLabel: ctx.sourceLabel ?? null,
  evidence: snippet.replace(/\s+/g, ' ').trim().slice(0, 300), verifiedAt: ctx.verifiedAt, status: 'verified',
});

/**
 * Reads explicit face-value statements:
 *  - "face value of Rs. 10 per share", "ordinary shares of Rs. 10/- each" (applies from the document date);
 *  - the same plus "unchanged" / "since incorporation|listing" (applies from the earliest covered date);
 *  - "face value changed|sub-divided|consolidated from Rs. A to Rs. B with effect from <date>" (A before, B from the date).
 * A change without a stated effective date, or a document stating several different values with no change
 * wording, is reported in `unclear` and stores nothing.
 */
export function extractFaceValueEvidence(rawText: string, ctx: ExtractContext): Extraction {
  const text = rawText.replace(/\s+/g, ' ');
  const entries: FaceValueEvidence[] = [];
  const unclear: string[] = [];
  const claimed: [number, number][] = [];

  const change = new RegExp(
    String.raw`(?:face|par|nominal)\s+value[^.]{0,160}?(?:from)\s+${RS}\s*${AMOUNT}\s*(?:\/-)?[^.]{0,40}?\bto\s+${RS}\s*${AMOUNT}(?<tail>[^.]{0,200})`,
    'gi',
  );
  for (const m of text.matchAll(change)) {
    const before = Number(m[1]);
    const after = Number(m[2]);
    claimed.push([m.index!, m.index! + m[0].length]);
    if (!validFaceValue(before) || !validFaceValue(after) || before === after) { unclear.push(`Unusable change: ${m[0].slice(0, 120)}`); continue; }
    const when = new RegExp(String.raw`(?:w\.?e\.?f\.?|with effect from|effective(?:\s+from|\s+date)?|on|from)\s*:?\s*${DATE_TEXT}`, 'i').exec(m.groups?.tail ?? '');
    const date = when ? parseStatementDate(when[1]) : null;
    if (!date) { unclear.push(`Face value change Rs ${before} to Rs ${after} has no stated effective date.`); continue; }
    entries.push(row(before, '', ctx, m[0]), row(after, date, ctx, m[0]));
  }

  // The tail is a lookahead so one statement never swallows the next ("... Rs. 10 each and ... Rs. 100 each").
  const stated = new RegExp(
    String.raw`(?:(?:face|par|nominal)\s+value\s+(?:of\s+|is\s+|was\s+)?(?:the\s+(?:company(?:'s)?\s+)?(?:ordinary\s+)?shares?\s+(?:is\s+|of\s+)?)?|shares?\s+of\s+)${RS}\s*${AMOUNT}\s*(?:\/-)?(?=(?<tail>[\s\S]{0,120}))`,
    'gi',
  );
  const found: { value: number; unchanged: boolean; snippet: string }[] = [];
  for (const m of text.matchAll(stated)) {
    const at = m.index!;
    if (claimed.some(([from, to]) => at >= from && at < to)) continue;
    // Preference shares, convertible instruments and debt carry their own par values: not the ordinary face value.
    if (/prefer|redeemable|convertible|debenture|sukuk|\bTFC\b|term finance/i.test(text.slice(Math.max(0, at - 40), at + 20))) continue;
    const value = Number(m[1]);
    if (!validFaceValue(value)) continue;
    const unchanged = /unchanged|not changed|since (?:its )?(?:incorporation|listing|inception)/i.test(m[0] + ' ' + (m.groups?.tail ?? '').slice(0, 80));
    found.push({ value, unchanged, snippet: (m[0] + (m.groups?.tail ?? '').slice(0, 60)).trim() });
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length > 1) unclear.push(`The document states more than one face value (${distinct.map((v) => `Rs ${v}`).join(', ')}) without a dated change.`);
  else if (distinct.length === 1) {
    const unchanged = found.some((f) => f.unchanged);
    if (unchanged) entries.push(row(distinct[0], '', ctx, found.find((f) => f.unchanged)!.snippet));
    else if (ctx.documentDate) entries.push(row(distinct[0], ctx.documentDate, ctx, found[0].snippet));
    else unclear.push(`Face value Rs ${distinct[0]} found in a document with no date.`);
  }
  return { entries, unclear };
}

// --- merging evidence ----------------------------------------------------------------------------------

/**
 * Folds newly extracted evidence into what is stored and returns the rows to write. The same start date with
 * the same value keeps the first verification; a different value for the same start date marks the stored row
 * `conflict` (the value is then unresolved) and records the disagreement. Different start dates are all kept.
 */
export function mergeFaceValueEvidence(existing: readonly FaceValueEvidence[], found: readonly FaceValueEvidence[]): FaceValueEvidence[] {
  const byStart = new Map(existing.map((e) => [e.effectiveFrom, { ...e }]));
  const writes = new Map<string, FaceValueEvidence>();
  for (const incoming of found) {
    const current = byStart.get(incoming.effectiveFrom);
    if (!current) {
      byStart.set(incoming.effectiveFrom, incoming);
      writes.set(incoming.effectiveFrom, incoming);
    } else if (current.faceValue !== incoming.faceValue) {
      const note = `Conflicting evidence: Rs ${incoming.faceValue} per ${incoming.sourceUrl}`;
      if (current.status === 'conflict' && current.evidence?.includes(note)) continue;
      const marked: FaceValueEvidence = { ...current, status: 'conflict', evidence: [current.evidence, note].filter(Boolean).join(' | ').slice(0, 600) };
      byStart.set(incoming.effectiveFrom, marked);
      writes.set(incoming.effectiveFrom, marked);
    }
  }
  return [...writes.values()];
}

/** The catalog's denormalized current value: verified evidence applying on `today`, else nothing. */
export function currentFaceValue(history: readonly FaceValueEvidence[], today: string) {
  const resolved = resolveFaceValue(history, today);
  return resolved.status === 'verified'
    ? { faceValue: resolved.faceValue, source: resolved.evidence.sourceUrl, verifiedAt: resolved.evidence.verifiedAt }
    : { faceValue: null, source: null, verifiedAt: null };
}

// --- D1 ------------------------------------------------------------------------------------------------

export const FACE_COLUMNS_PER_ROW = 8;
export const FACE_ROWS_PER_STATEMENT = Math.floor(100 / FACE_COLUMNS_PER_ROW);
export function faceValueUpsertSql(rows: number): string {
  return `INSERT INTO security_face_values (ticker,effective_from,face_value,source_url,source_label,evidence,verified_at,status)
          VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?,?,?)').join(',')}
          ON CONFLICT(ticker,effective_from) DO UPDATE SET face_value=excluded.face_value, source_url=excluded.source_url,
            source_label=excluded.source_label, evidence=excluded.evidence, verified_at=excluded.verified_at, status=excluded.status`;
}
export const faceValueParams = (ticker: string, e: FaceValueEvidence) => [
  ticker, e.effectiveFrom, e.faceValue, e.sourceUrl, e.sourceLabel, e.evidence, e.verifiedAt, e.status,
];
type StoredFace = { ticker: string; effective_from: string; face_value: number; source_url: string; source_label: string | null; evidence: string | null; verified_at: string; status: string };
export const evidenceFromStored = (r: StoredFace): FaceValueEvidence => ({
  faceValue: r.face_value, effectiveFrom: r.effective_from, sourceUrl: r.source_url, sourceLabel: r.source_label,
  evidence: r.evidence, verifiedAt: r.verified_at, status: r.status === 'conflict' ? 'conflict' : 'verified',
});

/** Evidence rows for the given tickers (chunked under D1's bound-parameter limit). */
/** The slice of D1Database this needs, so the module stays free of Workers typings (it is shared with the mobile app). */
type FaceValueDb = { prepare(sql: string): { bind(...args: unknown[]): { all<T>(): Promise<{ results: T[] }> } } };
export async function readFaceValues(db: FaceValueDb, tickers: string[]): Promise<Record<string, FaceValueEvidence[]>> {
  const out: Record<string, FaceValueEvidence[]> = {};
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const rows = await db
      .prepare(`SELECT ticker,effective_from,face_value,source_url,source_label,evidence,verified_at,status FROM security_face_values WHERE ticker IN (${part.map(() => '?').join(',')}) ORDER BY ticker,effective_from`)
      .bind(...part)
      .all<StoredFace>();
    for (const row of rows.results) (out[row.ticker] ??= []).push(evidenceFromStored(row));
  }
  return out;
}
