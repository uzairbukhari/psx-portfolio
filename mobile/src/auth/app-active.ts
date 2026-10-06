import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True while the app is in the foreground. The privacy covers (vault and optional app lock) sit over the whole
 * app, take every touch and hide the tabs while this is false, so a missed 'active' event must never leave one
 * stuck: while inactive it re-reads the real state twice a second and clears itself.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    setActive(AppState.currentState === 'active');
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (active) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') setActive(true);
    }, 500);
    return () => clearInterval(timer);
  }, [active]);
  return active;
}
