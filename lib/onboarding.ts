// New-user onboarding rules: the Getting started checklist and who sees it. Pure (no clock, no I/O, no React) so it can be
// tested and shared. Progress is derived from the decrypted portfolio where it can be (a first holding, a SIP budget);
// the rest is a few per-device flags kept in localStorage (see app/use-onboarding.ts). Nothing here goes to the server.

export const ONBOARDING_STORAGE_KEY = 'sipwise.onboarding';
export const ONBOARDING_VERSION = 1;

export const CHECKLIST_IDS = ['vault', 'first_holding', 'tax', 'backup', 'sip_budget', 'insights'] as const;
export type ChecklistId = (typeof CHECKLIST_IDS)[number];

/** Steps the person confirms or does outside the portfolio data, so they are remembered on this device. */
export type TourOutcome = 'completed' | 'skipped' | 'declined';
const TOUR_OUTCOMES: readonly string[] = ['completed', 'skipped', 'declined'];

export type TickId = 'tax' | 'backup' | 'insights';

export type OnboardingState = {
  v: typeof ONBOARDING_VERSION;
  /** PKT day this device first saw an account with nothing in it. Only such a device is onboarded. */
  fresh?: string;
  /** The person hid the checklist. */
  hidden?: true;
  /** How the first-visit tour ended (or was turned down). Absent until then; the tour is then offered once. */
  tour?: TourOutcome;
  ticks: Partial<Record<TickId, true>>;
  /** PKT day on which every item was first done, so the card can leave a day later. */
  doneOn?: string;
};

export const EMPTY_ONBOARDING: OnboardingState = { v: ONBOARDING_VERSION, ticks: {} };

/** Reads stored JSON defensively: anything unexpected falls back to a blank state. */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...EMPTY_ONBOARDING, ticks: {} };
  try {
    const x = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!x || typeof x !== 'object' || x.v !== ONBOARDING_VERSION) return { ...EMPTY_ONBOARDING, ticks: {} };
    const ticks: OnboardingState['ticks'] = {};
    for (const id of ['tax', 'backup', 'insights'] as const) if (x.ticks?.[id] === true) ticks[id] = true;
    return {
      v: ONBOARDING_VERSION,
      ...(typeof x.fresh === 'string' ? { fresh: x.fresh } : {}),
      ...(x.hidden === true ? { hidden: true as const } : {}),
      ...(typeof x.tour === 'string' && TOUR_OUTCOMES.includes(x.tour) ? { tour: x.tour } : {}),
      ticks,
      ...(typeof x.doneOn === 'string' ? { doneOn: x.doneOn } : {}),
    };
  } catch {
    return { ...EMPTY_ONBOARDING, ticks: {} };
  }
}

/** What the portfolio itself says about the person's progress. */
export type OnboardingFacts = {
  hasHolding: boolean;
  /** A monthly SIP budget above zero is saved. */
  hasSipBudget: boolean;
};

export type ChecklistItem = {
  id: ChecklistId;
  label: string;
  hint: string;
  done: boolean;
};

const COPY: Record<ChecklistId, { label: string; hint: string }> = {
  vault: { label: 'Create your private vault', hint: 'Your data is encrypted on this device' },
  first_holding: { label: 'Add your first holding', hint: 'Import a statement or add one by hand' },
  tax: { label: 'Set your tax status', hint: 'Filer or non-filer changes the dividend tax' },
  backup: { label: 'Download a backup', hint: 'An encrypted copy only you can open' },
  sip_budget: { label: 'Set a monthly SIP budget', hint: 'How much you plan to invest each month' },
  insights: { label: 'Look around Insights', hint: 'Where your money is and how it is doing' },
};

export function checklistItems(state: OnboardingState, facts: OnboardingFacts): ChecklistItem[] {
  const done: Record<ChecklistId, boolean> = {
    vault: true,
    first_holding: facts.hasHolding,
    tax: state.ticks.tax === true,
    backup: state.ticks.backup === true,
    sip_budget: facts.hasSipBudget,
    insights: state.ticks.insights === true,
  };
  return CHECKLIST_IDS.map((id) => ({ id, ...COPY[id], done: done[id] }));
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number; next: ChecklistItem | null } {
  return { done: items.filter((i) => i.done).length, total: items.length, next: items.find((i) => !i.done) ?? null };
}

/**
 * Whether the checklist card shows. Only on a device that was fresh, until the person hides it, and until the day after
 * the last item was done (that visit still shows an "all set" line).
 */
export function showChecklist(state: OnboardingState, items: ChecklistItem[], today: string): boolean {
  if (!state.fresh || state.hidden) return false;
  const { next } = checklistProgress(items);
  if (next) return true;
  return !state.doneOn || state.doneOn >= today;
}

/** The state to store when every item is done for the first time (stamps the day), otherwise the state unchanged. */
export function withDoneDay(state: OnboardingState, items: ChecklistItem[], today: string): OnboardingState {
  if (state.doneOn || checklistProgress(items).next) return state;
  return { ...state, doneOn: today };
}

/**
 * Whether to offer the tour on this visit: a fresh device, never offered before, with something to look at, on the
 * Holdings page. (The component also waits until no dialog is open.)
 */
export function shouldOfferTour(state: OnboardingState, facts: { hasHolding: boolean; onHoldings: boolean }): boolean {
  return !!state.fresh && !state.tour && facts.hasHolding && facts.onHoldings;
}
