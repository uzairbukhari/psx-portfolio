// Code, not the model, decides which cited claims stand. A fact citation must name a key that exists in the fact
// pack; a source citation must be a URL the job actually fetched or searched, and its quote must appear in the
// stored text. Claims that fail are removed and the conviction is reduced by a fixed rule.
import type { CompanyReport, FactPack, ReportEvidence, VerificationStats } from './types.ts';

/** A page or article the job really read: URL -> the text it saw (capped when stored). */
export type SeenSources = Map<string, string>;

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const MIN_QUOTE = 12;

function urlKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const key of Array.from(u.searchParams.keys())) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    return u.toString().replace(/\/$/, '');
  } catch { return null; }
}

export function sourceHolds(url: string, quote: string, seen: SeenSources): boolean {
  const key = urlKey(url);
  if (!key) return false;
  for (const [candidate, text] of seen) {
    if (urlKey(candidate) !== key) continue;
    return quote.trim().length >= MIN_QUOTE && normalise(text).includes(normalise(quote));
  }
  return false;
}

/** The URL was fetched or returned by search this run (or earlier and stored), regardless of any quote. */
export function sourceSeen(url: string, seen: SeenSources): boolean {
  const key = urlKey(url);
  return Boolean(key) && [...seen.keys()].some((candidate) => urlKey(candidate) === key);
}

function checkEvidence(item: ReportEvidence, pack: FactPack, seen: SeenSources): boolean {
  if (item.factKey) {
    const fact = pack.facts[item.factKey];
    return Boolean(fact) && fact.value !== null;
  }
  return sourceHolds(item.sourceUrl, item.quote, seen);
}

export const PENALTY_PER_DROPPED = 2;
export const MAX_PENALTY = 10;
/** The most a bear review may mark a report down. */
export const MAX_BEAR_ADJUSTMENT = 10;

/**
 * Conviction under the current, softer penalty rules. Reports stored before the change carry a bigger penalty
 * (5 per dropped claim, up to 30) inside `conviction`; add that back and apply today's rule instead.
 */
export function effectiveConviction(conviction: number, v: VerificationStats): number {
  const current = Math.min(MAX_PENALTY, v.dropped * PENALTY_PER_DROPPED);
  return Math.max(0, Math.min(100, Math.round(conviction + v.convictionPenalty - current)));
}

/** What the AI itself scored before source checks and the bear review marked it down. */
export function aiConviction(conviction: number, v: VerificationStats): number {
  return Math.max(0, Math.min(100, Math.round(conviction + v.convictionPenalty - (v.bearAdjustment ?? 0))));
}

export function verifyReport(report: CompanyReport, pack: FactPack, seen: SeenSources): { report: CompanyReport; stats: VerificationStats } {
  const evidence = report.evidence.map((item) => ({ ...item, verified: checkEvidence(item, pack, seen) }));
  const flags = report.holdingView.redFlags.map((flag) => ({ ...flag, verified: sourceHolds(flag.sourceUrl, flag.quote, seen) }));
  const catalysts = report.catalysts.filter((c) => c.sourceUrl === '' || sourceSeen(c.sourceUrl, seen));
  const claims = evidence.length + flags.length + report.catalysts.length;
  const droppedEvidence = evidence.filter((e) => !e.verified).length;
  const droppedFlags = flags.filter((f) => !f.verified).length;
  const droppedCatalysts = report.catalysts.length - catalysts.length;
  const dropped = droppedEvidence + droppedFlags + droppedCatalysts;
  const penalty = Math.min(MAX_PENALTY, dropped * PENALTY_PER_DROPPED);
  // An unverified red flag is not allowed to push a thesis to "broken": a sell signal needs verified evidence.
  const verifiedFlags = flags.filter((f) => f.verified);
  const thesisState = report.holdingView.thesisState === 'broken' && !verifiedFlags.length ? 'weakened' : report.holdingView.thesisState;
  return {
    report: {
      ...report,
      conviction: Math.max(0, Math.min(100, Math.round(report.conviction - penalty))),
      evidence: evidence.filter((e) => e.verified),
      catalysts,
      holdingView: { ...report.holdingView, thesisState, redFlags: verifiedFlags },
    },
    stats: { claims, verified: claims - dropped, dropped, convictionPenalty: penalty },
  };
}
