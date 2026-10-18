'use client';
// Sidebar state for the signed-in app on desktop: pinned (full menu), rail (icons only) or auto (rail that opens over
// the page on hover). The choice lives in this browser only, like the theme.
import { useCallback, useEffect, useState } from 'react';

export type SideMode = 'pinned' | 'rail' | 'auto';
const KEY = 'sipwise.sidebar';
const MODES: SideMode[] = ['pinned', 'rail', 'auto'];

function read(): SideMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return MODES.includes(v as SideMode) ? (v as SideMode) : 'pinned';
  } catch {
    return 'pinned';
  }
}

export function useSidebar() {
  const [mode, setModeState] = useState<SideMode>('pinned');
  useEffect(() => setModeState(read()), []);
  useEffect(() => {
    document.documentElement.dataset.side = mode;
  }, [mode]);
  const setMode = useCallback((next: SideMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private window: the choice just lasts for this visit */
    }
  }, []);
  // "[" collapses or expands the menu, unless the user is typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      setMode(mode === 'pinned' ? 'rail' : 'pinned');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);
  return { mode, setMode };
}
