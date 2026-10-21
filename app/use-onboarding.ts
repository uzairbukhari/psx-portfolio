'use client';
// Per-device onboarding flags (see lib/onboarding.ts): which checklist steps were confirmed here, whether the card was
// hidden, and whether this device counts as a new account's first. localStorage only, like the theme and sidebar; if
// storage is blocked the flags simply last for this visit.
import { useCallback, useState } from 'react';
import {
  EMPTY_ONBOARDING,
  ONBOARDING_STORAGE_KEY,
  parseOnboarding,
  type OnboardingState,
  type TickId,
  type TipId,
  type TourOutcome,
} from '@/lib/onboarding';
import { track } from './analytics';

function read(): OnboardingState {
  try {
    return parseOnboarding(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  } catch {
    return parseOnboarding(null);
  }
}

function write(state: OnboardingState) {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* blocked or full: the flags last for this visit only */
  }
}

export function useOnboarding() {
  // The dashboard mounts only after the vault is unlocked, in the browser, so the stored flags can be read up front.
  const [state, setState] = useState<OnboardingState>(() => (typeof window === 'undefined' ? EMPTY_ONBOARDING : read()));

  const update = useCallback((change: (prev: OnboardingState) => OnboardingState) => {
    setState((prev) => {
      const next = change(prev);
      if (next !== prev) write(next);
      return next;
    });
  }, []);

  /** This device saw an account with nothing in it: from now on it is onboarded. Does nothing if already marked. */
  const markFresh = useCallback(
    (day: string) => update((s) => (s.fresh ? s : { ...s, fresh: day })),
    [update],
  );
  const tick = useCallback(
    (id: TickId) =>
      update((s) => {
        if (s.ticks[id]) return s;
        track('onboarding_step_done', { step: id });
        return { ...s, ticks: { ...s.ticks, [id]: true } };
      }),
    [update],
  );
  const hide = useCallback(() => {
    track('onboarding_checklist', { action: 'hidden' });
    update((s) => (s.hidden ? s : { ...s, hidden: true }));
  }, [update]);
  const show = useCallback(
    () =>
      update((s) => {
        if (!s.hidden) return s;
        const next = { ...s };
        delete next.hidden;
        return next;
      }),
    [update],
  );
  const setTour = useCallback((outcome: TourOutcome) => update((s) => (s.tour === outcome ? s : { ...s, tour: outcome })), [update]);
  const dismissTip = useCallback(
    (id: TipId) =>
      update((s) => {
        if (s.tips?.[id]) return s;
        track('tip_dismissed', { tip: id });
        return { ...s, tips: { ...s.tips, [id]: true } };
      }),
    [update],
  );
  /** Brings every page tip back (Help > Show page tips again). */
  const resetTips = useCallback(
    () =>
      update((s) => {
        const next: OnboardingState = { ...s, tipsOn: true };
        delete next.tips;
        return next;
      }),
    [update],
  );
  const stampDone = useCallback((day: string) => update((s) => (s.doneOn ? s : { ...s, doneOn: day })), [update]);

  return { state, dismissTip, resetTips, setTour, markFresh, tick, hide, show, stampDone };
}

export type Onboarding = ReturnType<typeof useOnboarding>;
