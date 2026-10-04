// The reuse rule: AI is called for a company only when its inputs really changed. Everything else is read back
// from D1. Pure, so the rule is unit-tested without a model or a database.
import type { ReuseDecision, StoredReport } from './types.ts';

export const REPORT_VALID_DAYS = 35;
export const PRICE_MOVE_UPDATE_PCT = 10;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ReuseInput = {
  stored: Pick<StoredReport, 'inputsHash' | 'priceAtReport' | 'checkedAt'> | null;
  inputsHash: string;
  price: number | null;
  now: Date;
  /** Force an update (for example a super admin asked for a rerun). */
  force?: boolean;
};

/**
 * full  - nothing stored: build everything.
 * update - something changed (new filing, announcement or news, or the price moved a lot): rewrite the report.
 * carry - nothing changed but the report is older than the validity window: keep it, refresh valuation in code.
 * fresh - nothing changed and it is recent: use as is.
 */
export function decideReuse({ stored, inputsHash, price, now, force }: ReuseInput): ReuseDecision {
  if (!stored) return 'full';
  if (force || stored.inputsHash !== inputsHash) return 'update';
  if (stored.priceAtReport && price && stored.priceAtReport > 0) {
    const move = (Math.abs(price - stored.priceAtReport) / stored.priceAtReport) * 100;
    if (move > PRICE_MOVE_UPDATE_PCT) return 'update';
  }
  const ageDays = (now.getTime() - Date.parse(stored.checkedAt)) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays <= REPORT_VALID_DAYS ? 'fresh' : 'carry';
}

/** Whether the device may rely on a report: verified and checked within the validity window. */
export function reportUsable(report: Pick<StoredReport, 'checkedAt' | 'verification'>, now: Date): boolean {
  const ageDays = (now.getTime() - Date.parse(report.checkedAt)) / 86_400_000;
  const { claims, verified } = report.verification;
  // A report whose cited evidence mostly failed code verification is not relied on, whatever its age.
  return Number.isFinite(ageDays) && ageDays <= REPORT_VALID_DAYS && (claims === 0 || verified / claims >= 0.5);
}
