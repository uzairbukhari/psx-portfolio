import type { ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a phone.
const VARIANTS = {
  development: { suffix: '.dev', label: 'Sipwise Dev', api: 'http://localhost:3000' },
  staging: { suffix: '.staging', label: 'Sipwise Staging', api: process.env.API_BASE_URL ?? '' },
  production: { suffix: '', label: 'Sipwise', api: process.env.API_BASE_URL ?? '' },
} as const;

const variant = (process.env.APP_VARIANT ?? 'development') as keyof typeof VARIANTS;
const v = VARIANTS[variant] ?? VARIANTS.development;
const bundleId = `com.uzairbukhari.sipwise${v.suffix}`;
// Reversed iOS OAuth client id, e.g. com.googleusercontent.apps.123-abc
const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;

const config: ExpoConfig = {
  name: v.label,
  slug: 'sipwise',
  version: '0.1.0',
  scheme: `sipwise${v.suffix.replace('.', '-')}`,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: bundleId, supportsTablet: false },
  android: { package: bundleId },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, object]] : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    apiBaseUrl: v.api,
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? '',
    // Public identifier (not a secret); EAS cloud builds don't see the local .env.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '0e6be082-0810-45d2-9036-d8a93e53fdff' },
  },
};

export default config;
