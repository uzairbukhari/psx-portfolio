import { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { configureNotifications, notificationsModule, pushPreference, registerForPush } from './push';

// A tapped notification stays "last" until cleared; remember which ones were already opened so a
// remount (unlock, sign-in) does not open the same company again.
const opened = new Set<string>();

/** Renders nothing: keeps this phone's push token fresh and opens the company when a notification is tapped. */
export function PushBridge() {
  const { api } = useAuth();

  useEffect(() => {
    let live = true;
    void configureNotifications();
    void pushPreference.get().then((on) => {
      if (on && live) void registerForPush(api).catch(() => {});
    });
    const N = notificationsModule();
    const open = (r: { notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } } } | null) => {
      if (!r || opened.has(r.notification.request.identifier)) return;
      opened.add(r.notification.request.identifier);
      const ticker = r.notification.request.content.data?.ticker;
      if (typeof ticker === 'string' && /^[A-Z0-9]{2,12}$/.test(ticker))
        router.push({ pathname: '/company/[ticker]', params: { ticker } });
    };
    // A notification tapped while the app was closed.
    void N?.getLastNotificationResponseAsync().then(open);
    const sub = N?.addNotificationResponseReceivedListener(open);
    return () => {
      live = false;
      sub?.remove();
    };
  }, [api]);

  return null;
}
