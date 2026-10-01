// Dividend push notifications. expo-notifications is loaded defensively: an over-the-air update can reach
// a build made before the module was added, and that build must keep working (with push shown as unavailable).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import type { ApiClient } from '@/api/client';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;
export function notificationsModule(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

const PREF_KEY = 'sipwise.push';
export const pushPreference = {
  get: async () => (await SecureStore.getItemAsync(PREF_KEY).catch(() => null)) === '1',
  set: (on: boolean) => SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0'),
};

export const pushAvailable = () => notificationsModule() !== null && Device.isDevice;

/** Show notifications that arrive while the app is open, and set up the Android channel. */
export async function configureNotifications() {
  const N = notificationsModule();
  if (!N) return;
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android')
    await N.setNotificationChannelAsync('dividends', {
      name: 'Dividend announcements',
      importance: N.AndroidImportance.DEFAULT,
    }).catch(() => {});
}

/** Asks permission if needed, fetches this phone's Expo push token and registers it with the server. */
export async function registerForPush(api: ApiClient): Promise<string | null> {
  const N = notificationsModule();
  if (!N) return 'This build of the app cannot show notifications yet. Install the latest build.';
  if (!Device.isDevice) return 'Notifications only work on a real phone.';
  await configureNotifications();
  let { status } = await N.getPermissionsAsync();
  if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'Notifications are turned off for Sipwise in your phone settings.';
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  let token: string;
  try {
    token = (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch (e) {
    return `Could not get a notification token: ${e instanceof Error ? e.message : 'unknown error'}`;
  }
  await api.put('/api/mobile-push', { token });
  return null;
}

export async function unregisterPush(api: ApiClient) {
  await api.delete('/api/mobile-push').catch(() => {});
}
