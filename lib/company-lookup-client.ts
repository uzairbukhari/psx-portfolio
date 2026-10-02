// Pure rules behind the web company-lookup hook (app/use-company-lookup.ts), kept here so they are testable.
import type { CompanyLookup } from './api-types.ts';

/** Gives each lookup an id; only the newest id may update the screen, so a late reply for an old ticker is dropped. */
export function createLatest() {
  let current = 0;
  return { next: () => ++current, isCurrent: (id: number) => id === current, cancel: () => { current++; } };
}

export const POLL_INTERVAL_MS = 5_000;
/** Polling a pending lookup stops after this long; the user can retry. */
export const POLL_LIMIT_MS = 4 * 60_000;
export const DEBOUNCE_MS = 350;

/** What to do after a lookup answer: show it, ask the server to look the symbol up, or keep polling. */
export function nextLookupAction(result: CompanyLookup | undefined, alreadyRequested: boolean): 'show' | 'request' | 'poll' {
  if (!result || result.state === 'resolved') return 'show';
  if (result.state === 'pending') return 'poll';
  return result.canRequest && !alreadyRequested ? 'request' : 'show';
}

/** Add Company may be saved only with resolved name and sector. */
export const canSaveCompany = (lookup: { state: string; company: { name: string; sector: string } | null }) =>
  lookup.state === 'resolved' && !!lookup.company?.name.trim() && !!lookup.company?.sector.trim();
