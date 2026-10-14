'use client';
// Chart palette preference for the web app: persisted per device in localStorage, applied to <html data-chart-palette>.
import { useCallback, useSyncExternalStore } from 'react';
import {
  applyChartPalette,
  CHART_PALETTE_STORAGE_KEY,
  DEFAULT_CHART_PALETTE,
  parseChartPalette,
  type ChartPalette,
} from '@/lib/chart-palette';

const CHANGED = 'sipwise:chart-palette-changed';

function stored(): ChartPalette {
  try {
    return parseChartPalette(
      window.localStorage.getItem(CHART_PALETTE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_CHART_PALETTE;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CHART_PALETTE_STORAGE_KEY) return;
    applyChartPalette(stored(), document.documentElement);
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useChartPalette() {
  const palette = useSyncExternalStore(
    subscribe,
    stored,
    () => DEFAULT_CHART_PALETTE,
  );
  const setPalette = useCallback((next: ChartPalette) => {
    try {
      window.localStorage.setItem(CHART_PALETTE_STORAGE_KEY, next);
    } catch {
      /* storage may be blocked; the palette still applies for this visit */
    }
    applyChartPalette(next, document.documentElement);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { palette, setPalette };
}
