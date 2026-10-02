// Face-value evidence gathering, with I/O injected (GitHub Actions script + tests). For each ticker it reads the
// company's own PSX disclosures (the announcement links `company_facts` already holds), extracts explicit
// face-value statements from them, and stores dated evidence. Nothing is guessed: no statement, no value.
import {
  FACE_ROWS_PER_STATEMENT, currentFaceValue, evidenceFromStored, extractFaceValueEvidence, faceValueParams, faceValueUpsertSql,
  mergeFaceValueEvidence, validFaceValue, type FaceValueEvidence,
} from './face-values.ts';

export type FaceRunIo = {
  d1: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  /** Plain text of an official document (HTML stripped, PDF text extracted). */
  fetchDocument: (url: string) => Promise<string>;
  log?: (message: string) => void;
  now?: () => string;
};
export type CuratedFaceValue = { ticker: string; faceValue: number; effectiveFrom: string; sourceUrl: string; sourceLabel?: string; evidence?: string };
export type FaceRunOptions = {
  tickers: string[];
  dryRun?: boolean;
  /** Documents read per ticker (newest relevant first). */
  maxDocuments?: number;
  curated?: CuratedFaceValue[];
};
export type FaceRunReport = {
  perTicker: { ticker: string; found: number; documents: number; unclear: string[]; conflicts: number; error?: string }[];
};

/** Disclosure titles worth reading for a face value: capital changes and the annual report. */
export const RELEVANT_DISCLOSURE = /sub-?\s?division|split|consolidat|face value|par value|share capital|capital|annual report|prospectus|bonus|right/i;
const OFFICIAL_URL = /^https:\/\/[^\s/]+\.[^\s/]+\//;

type Announcement = { date?: string; title?: string; url?: string | null };

export async function runFaceValues(io: FaceRunIo, options: FaceRunOptions): Promise<FaceRunReport> {
  const now = io.now ?? (() => new Date().toISOString());
  const maxDocuments = options.maxDocuments ?? 4;
  const report: FaceRunReport = { perTicker: [] };
  for (const ticker of options.tickers) {
    const result: FaceRunReport['perTicker'][number] = { ticker, found: 0, documents: 0, unclear: [], conflicts: 0 };
    report.perTicker.push(result);
    try {
      const stored = (await io.d1('SELECT ticker,effective_from,face_value,source_url,source_label,evidence,verified_at,status FROM security_face_values WHERE ticker=?', [ticker])).map((r) => evidenceFromStored(r as never));
      const found: FaceValueEvidence[] = [];
      for (const c of (options.curated ?? []).filter((c) => c.ticker === ticker)) {
        if (!validFaceValue(c.faceValue) || !OFFICIAL_URL.test(c.sourceUrl) || !/^(\d{4}-\d{2}-\d{2})?$/.test(c.effectiveFrom)) { result.unclear.push(`Curated entry for ${ticker} is incomplete.`); continue; }
        found.push({ faceValue: c.faceValue, effectiveFrom: c.effectiveFrom, sourceUrl: c.sourceUrl, sourceLabel: c.sourceLabel ?? null, evidence: (c.evidence ?? 'Curated from an official document').slice(0, 300), verifiedAt: now(), status: 'verified' });
      }
      const [facts] = await io.d1('SELECT payload FROM company_facts WHERE ticker=?', [ticker]).catch(() => []);
      let announcements: Announcement[] = [];
      try { announcements = (JSON.parse(typeof facts?.payload === 'string' ? facts.payload : '{}') as { announcements?: Announcement[] }).announcements ?? []; } catch { /* no facts */ }
      const documents = announcements
        .filter((a) => a.url && OFFICIAL_URL.test(a.url) && RELEVANT_DISCLOSURE.test(a.title ?? ''))
        .sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? '')))
        .slice(0, maxDocuments);
      for (const doc of documents) {
        try {
          const text = await io.fetchDocument(doc.url!);
          result.documents++;
          const extraction = extractFaceValueEvidence(text, { sourceUrl: doc.url!, sourceLabel: doc.title, documentDate: /^\d{4}-\d{2}-\d{2}$/.test(doc.date ?? '') ? doc.date! : null, verifiedAt: now() });
          found.push(...extraction.entries);
          result.unclear.push(...extraction.unclear);
        } catch (error) {
          result.unclear.push(`A document could not be read (${(error instanceof Error ? error.message : String(error)).slice(0, 80)}).`);
        }
      }
      // Evidence from several documents may itself disagree; fold it in one by one so conflicts are recorded.
      let current = [...stored];
      const writes = new Map<string, FaceValueEvidence>();
      for (const entry of found) {
        for (const written of mergeFaceValueEvidence(current, [entry])) {
          writes.set(written.effectiveFrom, written);
          current = [...current.filter((c) => c.effectiveFrom !== written.effectiveFrom), written];
          if (written.status === 'conflict') result.conflicts++;
        }
      }
      result.found = writes.size;
      if (!options.dryRun) {
        const rows = [...writes.values()];
        for (let i = 0; i < rows.length; i += FACE_ROWS_PER_STATEMENT) {
          const part = rows.slice(i, i + FACE_ROWS_PER_STATEMENT);
          await io.d1(faceValueUpsertSql(part.length), part.flatMap((r) => faceValueParams(ticker, r)));
        }
        const day = new Date(Date.parse(now()) + 5 * 3_600_000).toISOString().slice(0, 10);
        const cur = currentFaceValue(current, day);
        await io.d1('UPDATE security_catalog SET face_value=?, face_value_source=?, face_value_verified_at=? WHERE ticker=?', [cur.faceValue, cur.source, cur.verifiedAt, ticker]);
        await io.d1(
          `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES ('face-value',?,?,?,NULL,0)
           ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_error=NULL, failure_count=0`,
          [ticker, now(), now()],
        );
      }
    } catch (error) {
      result.error = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      if (!options.dryRun)
        await io.d1(
          `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES ('face-value',?,?,NULL,?,1)
           ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_error=excluded.last_error, failure_count=refresh_state.failure_count+1`,
          [ticker, now(), result.error],
        ).catch(() => {});
    }
  }
  return report;
}
