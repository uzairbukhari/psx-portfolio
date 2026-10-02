import * as SecureStore from 'expo-secure-store';

const KEY = 'sipwise.token';

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

// A server sign-out that could not be sent (phone offline); retried on the next launch.
const PENDING_KEY = 'sipwise.pendingSignOut';
export const pendingSignOut = {
  get: () => SecureStore.getItemAsync(PENDING_KEY),
  set: (token: string) => SecureStore.setItemAsync(PENDING_KEY, token),
  clear: () => SecureStore.deleteItemAsync(PENDING_KEY),
};
