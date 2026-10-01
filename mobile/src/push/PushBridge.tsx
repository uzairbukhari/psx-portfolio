import { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { configureNotifications, notificationsModule, pushPreference, registerForPush } from './push';

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
    const open = (ticker: unknown) => {
      if (typeof ticker === 'string' && /^[A-Z0-9]{2,12}$/.test(ticker))
        router.push({ pathname: '/company/[ticker]', params: { ticker } });
    };
    // A notification tapped while the app was closed.
    void N?.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data?.ticker));
    const sub = N?.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.ticker));
    return () => {
      live = false;
      sub?.remove();
    };
  }, [api]);

  return null;
}
