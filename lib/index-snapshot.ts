// The four supported indices (KSE-100, KSE-30, KMI-30, All-Share), parsed from ONE PSX homepage fetch.
// Each index is parsed independently, so one missing or malformed panel never discards the others, and
// a failed or older observation never replaces (or re-dates) what is already stored for that index.
import { parseIndexSummary, type IndexSummary } from './psx-market.ts';

export const SUPPORTED_INDICES = ['KSE100', 'KSE30', 'KMI30', 'ALLSHR'] as const;
export type IndexCode = (typeof SUPPORTED_INDICES)[number];

export const INDEX_LABELS: Record<IndexCode, string> = {
  KSE100: 'KSE-100', KSE30: 'KSE-30', KMI30: 'KMI-30', ALLSHR: 'All-Share',
};

export type StoredIndex = {
  summary: IndexSummary;
  /** When this system retrieved this index (not the source time, which is `summary.asOf`). */
  retrievedAt: string;
  /** Latest failed refresh for this index, if any. Cleared by the next success. */
  lastFailure: { at: string; message: string } | null;
};
export type IndexSnapshot = Partial<Record<IndexCode, StoredIndex>>;

export type ParsedIndices = {
  indices: Partial<Record<IndexCode, IndexSummary>>;
  failures: Partial<Record<IndexCode, string>>;
};

export function parseSupportedIndices(html: string): ParsedIndices {
  const indices: ParsedIndices['indices'] = {};
  const failures: ParsedIndices['failures'] = {};
  for (const code of SUPPORTED_INDICES) {
    try {
      indices[code] = parseIndexSummary(html, code);
    } catch (error) {
      failures[code] = error instanceof Error ? error.message : String(error);
    }
  }
  return { indices, failures };
}

/**
 * Merges one scrape into the stored snapshot, per index. A success replaces the stored value only when
 * its source time is not older; a failure keeps the stored value untouched (same `retrievedAt`) and
 * records the failure beside it.
 */
export function mergeIndexSnapshot(
  previous: IndexSnapshot | null | undefined,
  parsed: ParsedIndices,
  retrievedAt: string,
): IndexSnapshot {
  const next: IndexSnapshot = { ...previous };
  for (const code of SUPPORTED_INDICES) {
    const incoming = parsed.indices[code];
    const stored = next[code];
    if (incoming) {
      if (stored && incoming.asOf < stored.summary.asOf) continue; // late, older observation
      next[code] = { summary: incoming, retrievedAt, lastFailure: null };
    } else if (stored && parsed.failures[code]) {
      next[code] = { ...stored, lastFailure: { at: retrievedAt, message: parsed.failures[code]!.slice(0, 300) } };
    }
  }
  return next;
}
