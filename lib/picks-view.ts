// What the Monthly Picks page shows, worked out from a ranking and the person's holdings. Pure: the shortlist table
// (one row per company, with why it is or is not a pick), the order text for a broker, and the plain-English reasons for
// anything left out. Nothing here is fetched or saved.
import { PICK_THRESHOLD } from './company-facts.ts';
import { CONCENTRATION_CAP_PCT, type HoldingValue } from './monthly-picks-allocation.ts';
import type { FactsState } from './monthly-picks-flow.ts';
import type { MonthlyPickEstimate, MonthlyPicksResearch } from './monthly-picks.ts';

export type RowTag = { kind: 'pick' | 'warn' | 'bad' | 'muted'; text: string };
export type PicksRow = {
  ticker: string;
  name: string;
  ticked: boolean;
  /** 1-based rank among the picks, null when not a pick. */
  rank: number | null;
  score: number | null;
  peTtm: number | null;
  epsYoYPct: number | null;
  /** Share of the stocks held now, percent; null when nothing is held or the value is unknown. */
  ownPct: number | null;
  tag: RowTag | null;
  /** "data today", "data 3d old", "no data yet": what the ranking is based on. */
  dataNote: string;
  stale: boolean;
};
export type FactsLite = { state: FactsState; ageDays: number | null; fetchedOn?: string | null; error?: string | null };

export function dataNote(info: FactsLite | undefined): { text: string; stale: boolean } {
  if (!info || info.state === 'missing') return { text: 'no data yet', stale: true };
  if (info.state === 'failed') return { text: 'data fetch failed', stale: true };
  if (info.state === 'stale') return { text: `data ${info.ageDays ?? '?'}d old`, stale: true };
  return { text: info.ageDays ? `data ${info.ageDays}d old` : 'data today', stale: false };
}

/** Each held company's share of the stocks held, in percent. */
export function ownShares(held: HoldingValue[]): Map<string, number> {
  const total = held.reduce((sum, h) => sum + (h.valuePkr ?? 0), 0);
  return new Map(held.filter((h) => (h.valuePkr ?? 0) > 0 && total > 0).map((h) => [h.ticker, Math.round(((h.valuePkr ?? 0) / total) * 1000) / 10]));
}

export type RowsInput = {
  list: { ticker: string; name: string }[];
  shortlist: string[];
  result: MonthlyPicksResearch | null;
  facts: Record<string, FactsLite | undefined>;
  held: HoldingValue[];
  order: 'ranked' | 'name';
  /** The public figures for every listed company, so unticked rows still show their numbers. */
  pub?: { companies: { ticker: string; metrics: { unavailable?: string | null; peTtm?: number | null; epsYoYPct?: number | null } }[]; scores: { ticker: string; score: number }[] };
};

export function picksRows(input: RowsInput): PicksRow[] {
  const { result } = input;
  const own = ownShares(input.held);
  const ticked = new Set(input.shortlist);
  const pickRank = new Map((result?.picks ?? []).map((pick, i) => [pick.ticker, i + 1]));
  const coverage = new Map((result?.coverage ?? []).map((c) => [c.ticker, c]));
  const limited = new Map((result?.sizing?.picks ?? []).filter((p) => p.constrainedBy === 'overweight' || p.constrainedBy === 'concentration_cap').map((p) => [p.ticker, p.constrainedBy]));
  const pubMetrics = new Map((input.pub?.companies ?? []).filter((c) => !c.metrics.unavailable).map((c) => [c.ticker, c.metrics]));
  const pubScore = new Map((input.pub?.scores ?? []).map((c) => [c.ticker, c.score]));
  const rows = input.list.map((entry): PicksRow => {
    const note = dataNote(input.facts[entry.ticker]);
    const cov = coverage.get(entry.ticker);
    const isTicked = ticked.has(entry.ticker);
    const rank = pickRank.get(entry.ticker) ?? null;
    let tag: RowTag | null = null;
    if (isTicked && result) {
      if (rank) tag = { kind: 'pick', text: `Pick ${rank}` };
      else if (!cov || cov.assessmentStatus === 'unassessed') tag = { kind: 'bad', text: 'No data' };
      else if (cov.ineligibleReason) tag = { kind: 'bad', text: 'Not eligible' };
      else if (limited.has(entry.ticker)) tag = { kind: 'warn', text: `Over ${CONCENTRATION_CAP_PCT}%` };
      else if ((cov.metrics?.score ?? 0) < PICK_THRESHOLD) tag = { kind: 'muted', text: `Below ${PICK_THRESHOLD}` };
      else tag = { kind: 'muted', text: 'Not in top 5' };
    }
    return {
      ticker: entry.ticker, name: entry.name, ticked: isTicked, rank,
      score: cov?.assessmentStatus === 'assessed' ? (cov.metrics?.score ?? null) : pubMetrics.has(entry.ticker) ? (pubScore.get(entry.ticker) ?? null) : null,
      peTtm: cov?.metrics?.peTtm ?? pubMetrics.get(entry.ticker)?.peTtm ?? null,
      epsYoYPct: cov?.metrics?.epsYoYPct ?? pubMetrics.get(entry.ticker)?.epsYoYPct ?? null,
      ownPct: own.get(entry.ticker) ?? null, tag, dataNote: note.text, stale: note.stale,
    };
  });
  const byName = (a: PicksRow, b: PicksRow) => a.ticker.localeCompare(b.ticker);
  if (input.order === 'name') return rows.sort(byName);
  // Ticked picks first (in rank order), then the other ticked companies by score, then the ones left unticked.
  const group = (r: PicksRow) => (r.rank ? 0 : r.ticked ? 1 : 2);
  return rows.sort((a, b) => group(a) - group(b) || (a.rank ?? 0) - (b.rank ?? 0) || (b.score ?? -1) - (a.score ?? -1) || byName(a, b));
}

/** Plain text a person can paste to a broker or keep as a note: one line per pick with shares and the price used. */
export function orderText(estimates: MonthlyPickEstimate[], month: string): string {
  const lines = estimates.filter((e) => e.shares !== null && e.shares > 0).map((e) => `${e.ticker} BUY ${e.shares} @ about ${e.price?.toFixed(2)}`);
  return lines.length ? [`Monthly Picks ${month}`, ...lines].join('\n') : '';
}

/** The one-line reasons shown under the ticket for companies that did not get money. */
export function leftOutNotes(rows: PicksRow[]): string[] {
  return rows
    .filter((r) => r.ticked && r.tag && r.tag.kind !== 'pick' && r.tag.text.startsWith('Over'))
    .map((r) => `${r.ticker} is left out: it is already ${r.ownPct ?? '?'}% of your stocks (limit ${CONCENTRATION_CAP_PCT}%). Nothing is sold.`);
}
