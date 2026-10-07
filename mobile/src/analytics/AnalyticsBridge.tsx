import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { configureAnalytics, track } from './analytics';
import { screenForPath } from './screens';

/** Connects usage analytics to the signed-in session: opens, foregrounds and screen views. */
export function AnalyticsBridge() {
  const { api } = useAuth();
  const path = usePathname();
  useEffect(() => {
    configureAnalytics((body) => api.post('/api/events', body));
    track('app_opened');
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') track('app_opened'); });
    return () => { sub.remove(); configureAnalytics(null); };
  }, [api]);
  useEffect(() => {
    const screen = screenForPath(path);
    if (screen) track('screen_viewed', { screen });
  }, [path]);
  return null;
}
