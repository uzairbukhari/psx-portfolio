// The phone's secure store as a BiometricKeyStore. `requireAuthentication` makes the system ask for the fingerprint
// or face on every read, and the key is dropped by the OS if the enrolled biometrics change.
import * as SecureStore from 'expo-secure-store';
import type { BiometricKeyStore } from './biometric-key';

export const nativeBiometricKeyStore: BiometricKeyStore = {
  available: () => {
    try { return SecureStore.canUseBiometricAuthentication(); } catch { return false; }
  },
  getMarker: (name) => SecureStore.getItemAsync(name),
  setMarker: (name, value) => SecureStore.setItemAsync(name, value),
  setSecret: (name, value, prompt) =>
    SecureStore.setItemAsync(name, value, { requireAuthentication: true, authenticationPrompt: prompt }),
  getSecret: (name, prompt) => SecureStore.getItemAsync(name, { requireAuthentication: true, authenticationPrompt: prompt }),
  remove: (name) => SecureStore.deleteItemAsync(name),
};
